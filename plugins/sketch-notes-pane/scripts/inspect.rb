# sketch notes: live pages. a separate Chrome profile started with its DevTools port open on
# 127.0.0.1. the sketch window opens in it, so the live pages framed on the board can be read: every
# visible element and the component that drew it (scripts/inspect.js runs in each page).
#
# loaded by window.rb. the DevTools connection is made from here, never from a browser page: chrome only
# lets in a websocket that sends no Origin header, so no website can reach the port.

require 'socket'
require 'json'
require 'uri'
require 'net/http'
require 'securerandom'
require 'fileutils'
require 'rbconfig'

module Inspect
  PROFILE = File.join(Dir.home, '.claude', 'sketch-notes', 'inspect-profile')
  PORT_FILE = File.join(PROFILE, 'sketch-notes-port')
  COLLECT = File.read(File.join(__dir__, 'inspect.js'))
  DEV_PORTS = [3000, 3001, 3002, 4200, 4321, 5000, 5173, 5174, 5175, 8000, 8080, 8081, 8888, 4000, 6006].freeze
  BROWSERS = ['Google Chrome', 'Brave Browser', 'Microsoft Edge', 'Chromium'].freeze
  LINUX_BROWSERS = %w[google-chrome google-chrome-stable chromium chromium-browser microsoft-edge brave-browser].freeze

  module_function

  def mac?
    RbConfig::CONFIG['host_os'] =~ /darwin/
  end

  DEV_COMMANDS = /\A(node|bun|deno|python\d*|ruby|php|java|dotnet|go|hugo|vite|next-serv|caddy|nginx|httpd|uvicorn|gunicorn|rails|puma)/i

  # local dev servers to offer as urls: ports a dev process listens on, from lsof (a plain connect can be
  # answered by a network filter or proxy even where nothing listens)
  def dev_servers(skip = [])
    out = IO.popen(['lsof', '-nP', '-iTCP', '-sTCP:LISTEN'], err: File::NULL, &:read).to_s
    ports = out.lines.drop(1).map do |line|
      cols = line.split
      next unless cols[0].to_s =~ DEV_COMMANDS
      addr = cols[8].to_s
      port = addr[/:(\d+)\z/, 1].to_i
      local = addr.start_with?('127.0.0.1:', 'localhost:', '*:', '[::1]:', '[::]:')
      port if local && port >= 1024
    end
    ports = ports.compact.uniq - skip
    ports.sort_by { |p| [DEV_PORTS.index(p) || 99, p] }.first(20)
  rescue StandardError
    []
  end

  # the same servers, each with the <title> its home page gives, so you can tell which app is which
  # a server that streams or never ends its answer is still listed, without a title, after 2.5s in all
  def dev_server_info(skip = [])
    titles = {}
    ports = dev_servers(skip)
    threads = ports.map do |p|
      Thread.new do
        Net::HTTP.start('127.0.0.1', p, open_timeout: 1, read_timeout: 1) do |h|
          buf = +''
          h.request_get('/', 'Accept' => 'text/html') do |res|
            res.read_body do |chunk|
              buf << chunk
              break if buf.bytesize > 200_000 || buf =~ %r{</title>}i
            end
          end
          titles[p] = buf.force_encoding(Encoding::UTF_8).scrub[%r{<title[^>]*>([^<]{1,120})</title>}i, 1].to_s.strip
        end
      rescue StandardError
        nil
      end
    end
    deadline = Time.now + 2.5
    threads.each { |t| t.join([deadline - Time.now, 0].max) || t.kill }
    ports.map { |p| { port: p, title: titles[p].to_s } }
  end

  def http(method, port, path, timeout = 3)
    Net::HTTP.start('127.0.0.1', port, open_timeout: timeout, read_timeout: timeout) do |h|
      req = method == :put ? Net::HTTP::Put.new(path) : Net::HTTP::Get.new(path)
      res = h.request(req)
      raise "devtools answered #{res.code}" unless res.is_a?(Net::HTTPSuccess)
      JSON.parse(res.body)
    end
  end

  def port
    p = File.read(PORT_FILE).to_i rescue 0
    return nil unless p > 0
    http(:get, p, '/json/version', 1)
    p
  rescue StandardError
    nil
  end

  def free_port
    s = TCPServer.new('127.0.0.1', 0)
    s.addr[1]
  ensure
    s&.close
  end

  # starts a chromium browser on the inspect profile with `args`; true when one started
  def start_browser(args)
    if mac?
      BROWSERS.each do |app|
        next unless system('open', '-Ra', app, out: File::NULL, err: File::NULL)
        return true if system('open', '-na', app, '--args', *args, out: File::NULL, err: File::NULL)
      end
    else
      LINUX_BROWSERS.each do |bin|
        next unless system("command -v #{bin} >/dev/null 2>&1")
        Process.detach(spawn(bin, *args, out: File::NULL, err: File::NULL))
        return true
      end
    end
    false
  end

  def wait_for(p)
    40.times do
      sleep 0.25
      begin
        http(:get, p, '/json/version', 1)
        return p
      rescue StandardError
        next
      end
    end
    raise 'the inspect profile did not open its DevTools port: close its windows and try again'
  end

  # the inspect profile running, its DevTools port open; `first` is what its first window shows
  def ensure_running(first_args)
    if (p = port)
      return [p, false]
    end
    FileUtils.mkdir_p(PROFILE)
    p = free_port
    args = ["--user-data-dir=#{PROFILE}", "--remote-debugging-port=#{p}", '--remote-debugging-address=127.0.0.1',
            '--no-first-run', '--no-default-browser-check', *first_args]
    raise 'live pages need Google Chrome, Brave, Edge or Chromium' unless start_browser(args)
    File.write(PORT_FILE, p.to_s)
    [wait_for(p), true]
  end

  # the sketch window, as an app window of the inspect profile, so its live pages can be read.
  # false when no chromium browser is there (the caller falls back to any browser)
  def open_app(url)
    app = ["--app=#{url}", '--start-maximized']
    _, started = ensure_running(app)
    # already running: the profile's running browser takes the new window
    start_browser(["--user-data-dir=#{PROFILE}", *app]) unless started
    true
  rescue StandardError
    false
  end

  def targets(p)
    http(:get, p, '/json/list')
  end

  def evaluate(target, expression, timeout = 15)
    cdp = CDP.new(target['webSocketDebuggerUrl'])
    begin
      res = cdp.call('Runtime.evaluate', { expression: expression, returnByValue: true, awaitPromise: true }, timeout)
      raise "the page would not run it: #{res.dig('exceptionDetails', 'text')}" if res['exceptionDetails']
      res.dig('result', 'value')
    ensure
      cdp.close
    end
  end

  # which live page each frame target is: the sketch window names every page's iframe by the page's id,
  # and a frame's window.name is that name
  @names = {}
  def frame_named(p, name)
    list = targets(p).select { |t| t['type'] == 'iframe' }
    list.each do |t|
      next if @names.key?(t['id'])
      @names[t['id']] = (evaluate(t, 'window.name', 3) rescue nil)
    end
    list.find { |t| @names[t['id']] == name }
  end

  # the folder a local dev server runs in, from the port in the page's url (lsof): where its sources are
  @roots = {}
  def project_root(url)
    u = URI.parse(url.to_s)
    return nil unless %w[localhost 127.0.0.1].include?(u.host) && u.port
    @roots.fetch(u.port) do
      pid = IO.popen(['lsof', '-nP', "-iTCP:#{u.port}", '-sTCP:LISTEN', '-t'], err: File::NULL, &:read).to_s.split.first
      cwd = pid && IO.popen(['lsof', '-p', pid, '-a', '-d', 'cwd', '-Fn'], err: File::NULL, &:read).to_s[/^n(.+)$/, 1]
      @roots[u.port] = cwd && File.directory?(cwd) ? cwd : nil
    end
  rescue StandardError
    nil
  end

  BUILT = %r{(\A|/)(_next/|\.next/|dist/|build/|assets/|static/chunks/|node_modules/)}
  SOURCE_EXT = %w[*.tsx *.jsx *.ts *.js *.vue *.svelte].freeze

  # where a component is defined in the project: "function Name", "const Name =", "class Name"
  def component_file(root, name, cache)
    return cache[name] if cache.key?(name)
    dirs = %w[src app components pages lib].map { |d| File.join(root, d) }.select { |d| File.directory?(d) }
    dirs = [root] if dirs.empty?
    args = ['grep', '-rlE', "(function|const|class|let) #{Regexp.escape(name)}\\b", *SOURCE_EXT.map { |e| "--include=#{e}" },
            '--exclude-dir=node_modules', '--exclude-dir=.next', '--exclude-dir=dist', '--exclude-dir=build', *dirs]
    hit = IO.popen(args, err: File::NULL, &:read).to_s.lines.first&.strip
    cache[name] = hit && !hit.empty? ? hit.sub("#{root}/", '') : nil
  rescue StandardError
    cache[name] = nil
  end

  # the line an element was written at, in a file the browser could not map: the first line at or after
  # its parent's that has its whole class list, its first classes, or its text
  # `after` is past what the same component already placed inside the same parent (jsx is written in
  # page order); `floor` is the parent's own line. a list item's lines repeat, so it falls back to floor
  def find_line(lines, el, after, floor)
    cls = el['cls'].to_s.split
    text = el['text'].to_s[0, 40].strip
    keys = []
    # an element with its own words (a heading, a button) is found by them: styles are often shared
    leaf = text.size >= 6 && !%w[div section main header footer nav ul ol form].include?(el['tag'])
    keys << text if leaf
    keys << cls.join(' ') if cls.size >= 2
    keys << cls.first(3).join(' ') if cls.size >= 3
    keys << cls.first(2).join(' ') if cls.size >= 2
    hits = keys.map { |k| lines.each_index.select { |i| lines[i].include?(k) } }
    [after, floor].each do |bound|
      hits.each { |h| (i = h.find { |x| x >= bound }) && (return i) }
    end
    hits.find(&:any?)&.first
  end

  # a source file and no line (a server component, or no source map): find the element's line in the
  # file itself. a build file never stands as a source: the component's own file is looked up instead
  def refine_sources(data)
    root = project_root(data['url'])
    return data unless root
    files = {}
    defs = {}
    found = {} # element index -> [file, line index, component]
    els = Array(data['elements'])
    els.each do |el|
      src = el['src'].to_s
      if src =~ BUILT || (src.empty? && el['comp'])
        file = el['comp'] && component_file(root, el['comp'].first, defs)
        src = file.to_s
        el['src'] = file
      end
      next if src.empty?
      comp = el['comp'] && el['comp'].first
      if (m = src.match(/\A(.+):(\d+)\z/))
        found[el['i']] = [m[1], m[2].to_i - 1, comp]
        next
      end
      path = src.start_with?('/') ? src : File.join(root, src)
      lines = files[path] ||= (File.file?(path) && File.size(path) < 2_000_000 ? File.readlines(path) : [])
      next if lines.empty?
      # the nearest ancestor placed in this file, and what this component placed since inside it
      a = el['p']
      a = els[a] && els[a]['p'] while a && a >= 0 && !(found[a] && found[a][0] == src)
      floor = a && a >= 0 ? found[a][1] : 0
      after = floor
      found.each { |i, (f, l, c)| after = [after, l + 1].max if i > (a || -1) && f == src && c == comp }
      at = find_line(lines, el, after, floor)
      next unless at
      el['src'] = "#{src}:#{at + 1}"
      found[el['i']] = [src, at, comp]
    end
    data
  end

  # every visible element of one live page and the component that drew it
  def inspect_frame(name)
    p = port or raise 'live pages are not readable: the sketch window is not in the inspect profile'
    t = frame_named(p, name)
    unless t
      @names.clear
      t = frame_named(p, name) or raise 'that page is not answering as a frame (it may refuse to be framed)'
    end
    refine_sources(evaluate(t, COLLECT) || {}).merge('ok' => true)
  rescue StandardError => e
    { ok: false, error: e.message }
  end

  # a region of the sketch window itself, in its own css pixels: how a live page is snapshotted
  # real mouse input into the sketch window at css pixel (x, y): how a page on the board is scrolled
  # and clicked like it is in chrome, nested scroll areas and all. events: {type: wheel|click, x, y, dx, dy}
  def input(token, events)
    p = port or raise 'the sketch window is not in the inspect profile'
    t = targets(p).find { |x| x['type'] == 'page' && x['url'].to_s.include?("t=#{token}") } or raise 'the sketch window is not found'
    cdp = CDP.new(t['webSocketDebuggerUrl'])
    begin
      Array(events).first(20).each do |ev|
        x = ev['x'].to_f
        y = ev['y'].to_f
        case ev['type']
        when 'wheel'
          cdp.call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: x, y: y, deltaX: ev['dx'].to_f, deltaY: ev['dy'].to_f })
        when 'click'
          base = { x: x, y: y, button: 'left', clickCount: 1 }
          cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x, y: y })
          cdp.call('Input.dispatchMouseEvent', base.merge(type: 'mousePressed', buttons: 1))
          cdp.call('Input.dispatchMouseEvent', base.merge(type: 'mouseReleased', buttons: 0))
        end
      end
      { ok: true }
    ensure
      cdp.close
    end
  rescue StandardError => e
    { ok: false, error: e.message }
  end

  def snapshot_window(token, clip)
    p = port or raise 'the sketch window is not in the inspect profile'
    t = targets(p).find { |x| x['type'] == 'page' && x['url'].to_s.include?("t=#{token}") } or raise 'the sketch window is not found'
    cdp = CDP.new(t['webSocketDebuggerUrl'])
    begin
      shot = cdp.call('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: clip }, 20)
      shot['data'].to_s.unpack1('m')
    ensure
      cdp.close
    end
  end

  # a page that refuses to be framed: opened in a tab of the inspect profile, captured with its
  # elements, and closed
  def snapshot_url(url)
    u = URI.parse(url.to_s.strip)
    raise 'only http and https pages can be shown' unless %w[http https].include?(u.scheme)
    p, = ensure_running(['about:blank'])
    made = http(:put, p, "/json/new?#{u}")
    begin
      t = nil
      40.times do
        sleep 0.25
        t = targets(p).find { |x| x['id'] == made['id'] }
        break if t && (evaluate(t, 'document.readyState', 3) rescue nil) == 'complete'
      end
      sleep 0.6
      capture(made['id'])
    ensure
      begin
        Net::HTTP.start('127.0.0.1', p, open_timeout: 2, read_timeout: 2) { |h| h.get("/json/close/#{made['id']}") }
      rescue StandardError
        nil
      end
    end
  rescue StandardError => e
    { ok: false, error: e.message }
  end

  def capture(id)
    p = port or raise 'the inspect profile is not open'
    target = targets(p).find { |t| t['id'] == id } or raise 'that page is gone'
    cdp = CDP.new(target['webSocketDebuggerUrl'])
    begin
      cdp.call('Page.bringToFront')
      sleep 0.15
      found = cdp.call('Runtime.evaluate', { expression: COLLECT, returnByValue: true, awaitPromise: true }, 20)
      raise "the page would not run the inspector: #{found.dig('exceptionDetails', 'text')}" if found['exceptionDetails']
      data = found.dig('result', 'value') || {}
      shot = cdp.call('Page.captureScreenshot', { format: 'png', fromSurface: true }, 20)
      refine_sources(data).merge('ok' => true, 'png' => shot['data'])
    ensure
      cdp.close
    end
  rescue StandardError => e
    { ok: false, error: e.message }
  end

  # the least of a websocket client: enough for chrome's DevTools protocol on 127.0.0.1
  class CDP
    def initialize(ws_url)
      uri = URI(ws_url.to_s)
      raise 'devtools gave no websocket' unless uri.host
      @sock = TCPSocket.new(uri.host, uri.port)
      key = [SecureRandom.random_bytes(16)].pack('m0')
      path = uri.path.to_s.empty? ? '/' : uri.path
      path += "?#{uri.query}" if uri.query
      @sock.write("GET #{path} HTTP/1.1\r\nHost: #{uri.host}:#{uri.port}\r\nUpgrade: websocket\r\n" \
                  "Connection: Upgrade\r\nSec-WebSocket-Key: #{key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
      status = @sock.gets("\r\n").to_s
      raise "devtools refused the connection: #{status.strip}" unless status.include?(' 101 ')
      while (line = @sock.gets("\r\n")) && line != "\r\n"; end
      @id = 0
    end

    # params and timeout are positional: a trailing hash would be read as keywords on ruby 2.6
    def call(method, params = {}, timeout = 15)
      @id += 1
      send_frame(JSON.generate(id: @id, method: method, params: params))
      deadline = Time.now + timeout
      loop do
        msg = JSON.parse(read_message(deadline))
        next unless msg['id'] == @id
        raise "#{method}: #{msg['error']['message']}" if msg['error']
        return msg['result'] || {}
      end
    end

    def close
      @sock.close
    rescue StandardError
      nil
    end

    private

    def send_frame(text, opcode = 0x1)
      data = text.b
      len = data.bytesize
      head = [0x80 | opcode].pack('C')
      head << if len < 126 then [0x80 | len].pack('C')
              elsif len < 65_536 then [0x80 | 126, len].pack('Cn')
              else [0x80 | 127, len].pack('CQ>')
              end
      mask = SecureRandom.random_bytes(4).bytes
      head << mask.pack('C*')
      bytes = data.bytes
      bytes.each_index { |i| bytes[i] ^= mask[i & 3] }
      @sock.write(head + bytes.pack('C*'))
    end

    def read_exact(n, deadline)
      buf = ''.b
      while buf.bytesize < n
        left = deadline - Time.now
        raise 'devtools took too long' if left <= 0 || !IO.select([@sock], nil, nil, left)
        buf << @sock.readpartial(n - buf.bytesize)
      end
      buf
    end

    def read_message(deadline)
      data = ''.b
      loop do
        b0, b1 = read_exact(2, deadline).unpack('CC')
        op = b0 & 0x0f
        len = b1 & 0x7f
        len = read_exact(2, deadline).unpack1('n') if len == 126
        len = read_exact(8, deadline).unpack1('Q>') if len == 127
        mask = (b1 & 0x80).zero? ? nil : read_exact(4, deadline).bytes
        payload = len.positive? ? read_exact(len, deadline) : ''.b
        if mask
          b = payload.bytes
          b.each_index { |i| b[i] ^= mask[i & 3] }
          payload = b.pack('C*')
        end
        case op
        when 0x8 then raise 'devtools closed the connection'
        when 0x9 then send_frame(payload, 0xA)
        when 0xA then nil
        else
          data << payload
          return data.force_encoding(Encoding::UTF_8) unless (b0 & 0x80).zero?
        end
      end
    end
  end
end

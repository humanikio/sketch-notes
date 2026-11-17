# sketch notes: the sketch board. serves scripts/window.html and scripts/canvas/ on 127.0.0.1 behind a
# one-time token, opens it full screen (in the inspect profile, so live pages can be read), and waits.
#
#   ruby window.rb --out PNG [--image IMAGE] [--no-open]
#
# prints one json line per event on stdout:
#   {"ready":true,"url":...,"live":true|false}           the board is served (and was opened)
#   {"ok":true,"path":...,"note":...,"notes":[...],"pages":[...]}   attach: the png(s) written, then it exits
#   {"cancelled":true,"reason":...}                      cancel, a closed window, or 4 idle hours, then it exits
#
# notes: {n, text, where, on (a page letter), element: {component, source, tag, text, selector, testid}}
# pages: {letter, url, title, path (a crop of that page, when one was made)}
#
# the board is kept beside the png: <folder>/board/board.json and <folder>/board/images/<id>.
# it listens only on 127.0.0.1 and answers only requests that carry the token.

require 'socket'
require 'json'
require 'securerandom'
require 'tmpdir'
require 'fileutils'
require 'rbconfig'
require 'uri'
require_relative 'inspect'

IDLE = 4 * 60 * 60
GRACE = 5 # seconds to wait for a reload after the page goes away
MAX_BODY = 64 * 1024 * 1024
WEB_IMAGE = /\.(png|jpe?g|gif|webp|bmp)\z/i
TYPES = {
  'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'gif' => 'image/gif',
  'webp' => 'image/webp', 'bmp' => 'image/bmp'
}.freeze
REASONS = { 200 => 'OK', 400 => 'Bad Request', 403 => 'Forbidden', 404 => 'Not Found', 413 => 'Too Large', 415 => 'Unsupported' }.freeze
STATIC = File.join(__dir__, 'canvas')
STATIC_NAMES = /\A[a-z][a-z0-9-]{0,30}\.(js|css)\z/

def emit(obj)
  $stdout.puts JSON.generate(obj)
  $stdout.flush
end

args = ARGV.dup
open_window = !args.delete('--no-open')
out = (i = args.index('--out')) ? File.expand_path(args[i + 1].to_s) : nil
image = (i = args.index('--image')) ? File.expand_path(args[i + 1].to_s) : nil
abort 'usage: ruby window.rb --out PNG [--image IMAGE] [--no-open]' unless out
image = nil if image && !File.file?(image)

TOKEN = SecureRandom.hex(16)
BOARD = File.join(File.dirname(out), 'board')
BOARD_FILE = File.join(BOARD, 'board.json')
BOARD_IMAGES = File.join(BOARD, 'images')
IMAGE_ID = /\A[a-z0-9]{1,24}\z/

# an image a browser cannot show (heic, tiff, ...) as png bytes, through sips or magick
def to_png(bytes, ext)
  Dir.mktmpdir('sketch-notes') do |dir|
    src = File.join(dir, "in.#{ext.to_s.empty? ? 'img' : ext}")
    dst = File.join(dir, 'out.png')
    File.binwrite(src, bytes)
    ok = if system('command -v sips >/dev/null 2>&1')
           system('sips', '-s', 'format', 'png', src, '--out', dst, out: File::NULL, err: File::NULL)
         else
           system('magick', "#{src}[0]", "PNG:#{dst}", out: File::NULL, err: File::NULL)
         end
    ok && File.file?(dst) ? File.binread(dst) : nil
  end
end

def respond(client, status, type, body)
  client.write("HTTP/1.1 #{status} #{REASONS[status] || 'OK'}\r\nContent-Type: #{type}\r\n" \
               "Content-Length: #{body.bytesize}\r\nCache-Control: no-store\r\n" \
               "X-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n")
  client.write(body)
end

def json(client, obj, status = 200)
  respond(client, status, 'application/json', JSON.generate(obj))
end

def read_request(client)
  line = client.gets("\r\n", 8192) or return nil
  method, target = line.split(' ', 3)
  headers = {}
  while (h = client.gets("\r\n", 8192)) && h != "\r\n"
    k, v = h.split(':', 2)
    headers[k.to_s.strip.downcase] = v.to_s.strip
  end
  len = headers['content-length'].to_i
  return [method, target, headers, :too_large] if len > MAX_BODY
  [method, target, headers, len > 0 ? client.read(len).to_s : '']
end

def param(query, name, pattern = /[^&]*/)
  raw = query.to_s[/(?:\A|&)#{name}=(#{pattern})/, 1]
  raw && URI.decode_www_form_component(raw)
end

# a chromeless app window where a chromium browser is installed, else the default browser
def open_url(url)
  if RbConfig::CONFIG['host_os'] =~ /darwin/
    ['Google Chrome', 'Brave Browser', 'Microsoft Edge', 'Chromium', 'Arc'].each do |app|
      next unless system('open', '-Ra', app, out: File::NULL, err: File::NULL)
      return if system('open', '-na', app, '--args', "--app=#{url}", '--start-maximized',
                       out: File::NULL, err: File::NULL)
    end
    system('open', url, out: File::NULL, err: File::NULL)
  else
    %w[google-chrome google-chrome-stable chromium chromium-browser microsoft-edge brave-browser].each do |bin|
      next unless system("command -v #{bin} >/dev/null 2>&1")
      Process.detach(spawn(bin, "--app=#{url}", '--start-maximized', out: File::NULL, err: File::NULL))
      return
    end
    system('xdg-open', url, out: File::NULL, err: File::NULL)
  end
end

def clean_element(el)
  return nil unless el.is_a?(Hash)
  {
    component: Array(el['component']).first(4).map { |c| c.to_s[0, 60] },
    source: el['source'].to_s[0, 300],
    tag: el['tag'].to_s[0, 30],
    text: el['text'].to_s[0, 80],
    selector: el['selector'].to_s[0, 300],
    testid: el['testid'].to_s[0, 60]
  }.reject { |_, v| v.respond_to?(:empty?) && v.empty? }
end

def clean_notes(list)
  Array(list).first(99).map do |n|
    next unless n.is_a?(Hash)
    text = n['text'].to_s.strip[0, 2000]
    next if text.empty?
    note = { n: n['n'].to_i, where: n['where'].to_s[0, 80], text: text }
    note[:on] = n['on'].to_s[0, 2] if n['on'].to_s =~ /\A[A-Z]{1,2}\z/
    el = clean_element(n['element'])
    note[:element] = el if el
    note
  end.compact
end

# the pages on the sketch, each with a crop of it written beside the png when the board sent one
def clean_pages(list, out)
  Array(list).first(26).map do |p|
    next unless p.is_a?(Hash) && p['letter'].to_s =~ /\A[A-Z]{1,2}\z/
    page = { letter: p['letter'], url: p['url'].to_s[0, 500], title: p['title'].to_s[0, 200] }
    page.delete(:url) unless page[:url] =~ %r{\Ahttps?://}
    bytes = p['png'].to_s.unpack1('m') if p['png']
    if bytes && bytes.start_with?("\x89PNG".b)
      crop = out.sub(/\.png\z/, "-page-#{p['letter']}.png")
      File.binwrite(crop, bytes)
      page[:path] = crop
    end
    page
  end.compact
end

# ---- screenshots of open windows (macOS) ----
# the windows on screen, from the window server, through osascript's javascript bridge
WINDOW_LIST_JS = <<~JS
  ObjC.import('CoreGraphics')
  const raw = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(
    $.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, $.kCGNullWindowID)))
  JSON.stringify((raw || []).filter(w => w.kCGWindowLayer === 0 && w.kCGWindowBounds.Width >= 120 &&
    w.kCGWindowBounds.Height >= 80 && (w.kCGWindowAlpha === undefined || w.kCGWindowAlpha > 0))
    .map(w => ({ id: w.kCGWindowNumber, app: w.kCGWindowOwnerName || '', title: w.kCGWindowName || '',
      w: Math.round(w.kCGWindowBounds.Width), h: Math.round(w.kCGWindowBounds.Height) })))
JS
SCREEN_SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

def mac?
  RbConfig::CONFIG['host_os'] =~ /darwin/
end

# one window's pixels, nil when macOS refuses (no Screen Recording permission)
def capture_window(id, format = 'png')
  Dir.mktmpdir('sketch-notes') do |dir|
    file = File.join(dir, "shot.#{format}")
    system('screencapture', '-l', id.to_s, '-o', '-x', '-t', format, file, out: File::NULL, err: File::NULL)
    File.file?(file) && File.size(file) > 0 ? File.binread(file) : nil
  end
end

def thumbnail(id)
  Dir.mktmpdir('sketch-notes') do |dir|
    file = File.join(dir, 'thumb.jpg')
    system('screencapture', '-l', id.to_s, '-o', '-x', '-t', 'jpg', file, out: File::NULL, err: File::NULL)
    next nil unless File.file?(file) && File.size(file) > 0
    system('sips', '-Z', '420', file, out: File::NULL, err: File::NULL)
    [File.binread(file)].pack('m0')
  end
end

def list_windows
  return { ok: false, error: 'window screenshots work on macOS only' } unless mac?
  out = IO.popen(['osascript', '-l', 'JavaScript', '-e', WINDOW_LIST_JS], err: File::NULL, &:read)
  wins = begin
    JSON.parse(out.to_s.strip.empty? ? '[]' : out)
  rescue JSON::ParserError
    []
  end
  # leave out the sketch window itself
  wins = wins.reject { |w| w['title'] == 'Sketch' }.first(30)
  wins.map { |w| Thread.new { w['thumb'] = thumbnail(w['id']) } }.each(&:join)
  shot = wins.select { |w| w['thumb'] }
  { ok: true, permission: wins.empty? || !shot.empty?, windows: shot, missing: wins.size - shot.size }
end

# ---- the board, kept between runs ----
def load_board
  return { ok: true, board: nil } unless File.file?(BOARD_FILE)
  { ok: true, board: JSON.parse(File.read(BOARD_FILE)) }
rescue JSON::ParserError
  { ok: true, board: nil }
end

def save_board(body)
  data = JSON.parse(body)
  raise 'not a board' unless data.is_a?(Hash) && data['objects'].is_a?(Array)
  FileUtils.mkdir_p(BOARD)
  tmp = "#{BOARD_FILE}.tmp"
  File.write(tmp, JSON.generate(data))
  File.rename(tmp, BOARD_FILE)
  { ok: true }
end

# starts a fresh board, keeping the old one as board-<time>.json
def new_board
  if File.file?(BOARD_FILE)
    File.rename(BOARD_FILE, File.join(BOARD, "board-#{Time.now.strftime('%Y-%m-%dT%H-%M-%S')}.json"))
  end
  { ok: true }
end

server = TCPServer.new('127.0.0.1', 0)
port = server.addr[1]
url = "http://127.0.0.1:#{port}/?t=#{TOKEN}"
page = File.read(File.join(__dir__, 'window.html'))
           .sub('__TOKEN__', TOKEN)
           .sub('__HAS_IMAGE__', image ? 'true' : 'false')

live = false
if open_window
  live = Inspect.open_app(url)
  open_url(url) unless live
end
emit(ready: true, url: url, live: live)

last = Time.now
gone_at = nil
loop do
  wait = gone_at ? gone_at + GRACE - Time.now : last + IDLE - Time.now
  unless IO.select([server], nil, nil, [wait, 0].max)
    emit(cancelled: true, reason: gone_at ? 'the window was closed' : 'no activity for 4 hours')
    exit 0
  end
  client = server.accept
  begin
    method, target, headers, body = read_request(client)
    next unless method
    path, query = target.to_s.split('?', 2)

    # the board's own scripts: plugin code, no token needed (a module import carries no query)
    if method == 'GET' && path.start_with?('/static/')
      name = path.sub('/static/', '')
      file = File.join(STATIC, name)
      if name =~ STATIC_NAMES && File.file?(file)
        respond(client, 200, name.end_with?('.css') ? 'text/css' : 'text/javascript; charset=utf-8', File.read(file))
      else
        respond(client, 404, 'text/plain', 'not found')
      end
      next
    end

    token = query.to_s[/(?:\A|&)t=([0-9a-f]+)/, 1]
    origin = headers['origin']
    # the token, and a page served from here, keep every other page out
    if token != TOKEN || (origin && origin != "http://127.0.0.1:#{port}")
      respond(client, 403, 'text/plain', 'forbidden')
      next
    end
    if body == :too_large
      respond(client, 413, 'text/plain', 'too large')
      next
    end
    last = Time.now
    gone_at = nil

    case [method, path]
    when ['GET', '/']
      respond(client, 200, 'text/html; charset=utf-8', page)
    when ['GET', '/status']
      json(client, ok: true, live: Inspect.port ? true : false)
    when ['GET', '/image']
      if image.nil?
        respond(client, 404, 'text/plain', 'no image')
      elsif image =~ WEB_IMAGE
        respond(client, 200, TYPES[File.extname(image).delete('.').downcase], File.binread(image))
      else
        png = to_png(File.binread(image), File.extname(image).delete('.'))
        png ? respond(client, 200, 'image/png', png) : respond(client, 415, 'text/plain', 'cannot read that image')
      end
    when ['POST', '/convert']
      ext = query.to_s[/(?:\A|&)ext=([a-z0-9]{1,8})/i, 1].to_s.downcase
      png = to_png(body, ext)
      png ? respond(client, 200, 'image/png', png) : respond(client, 415, 'text/plain', 'cannot read that image')

    # the board
    when ['GET', '/board']
      json(client, load_board)
    when ['PUT', '/board']
      json(client, save_board(body))
    when ['POST', '/board/new']
      json(client, new_board)
    when ['PUT', '/board/image']
      id = param(query, 'id', /[a-z0-9]{1,24}/)
      if id && id =~ IMAGE_ID
        FileUtils.mkdir_p(BOARD_IMAGES)
        File.binwrite(File.join(BOARD_IMAGES, id), body)
        json(client, ok: true)
      else
        json(client, { ok: false, error: 'bad id' }, 400)
      end
    when ['GET', '/board/image']
      id = param(query, 'id', /[a-z0-9]{1,24}/)
      file = id && File.join(BOARD_IMAGES, id)
      if file && id =~ IMAGE_ID && File.file?(file)
        bytes = File.binread(file)
        type = bytes.start_with?("\x89PNG".b) ? 'image/png' : bytes.start_with?("\xFF\xD8".b) ? 'image/jpeg' : 'application/octet-stream'
        respond(client, 200, type, bytes)
      else
        respond(client, 404, 'text/plain', 'no such image')
      end

    # live pages
    when ['GET', '/servers']
      json(client, ok: true, servers: Inspect.dev_server_info([port, Inspect.port].compact))
    when ['GET', '/pages/inspect']
      name = param(query, 'name', /[a-z0-9-]{1,40}/).to_s
      json(client, Inspect.inspect_frame("sketch-page-#{name}"))
    when ['POST', '/pages/snapshot']
      clip = { x: param(query, 'x').to_f, y: param(query, 'y').to_f, width: param(query, 'w').to_f,
               height: param(query, 'h').to_f, scale: [[param(query, 'scale').to_f, 0.1].max, 4].min }
      begin
        respond(client, 200, 'image/png', Inspect.snapshot_window(TOKEN, clip))
      rescue StandardError => e
        respond(client, 415, 'text/plain', e.message)
      end
    when ['POST', '/pages/input']
      events = begin
        JSON.parse(body)
      rescue JSON::ParserError
        []
      end
      json(client, Inspect.input(TOKEN, events))
    when ['POST', '/pages/fallback']
      json(client, Inspect.snapshot_url(param(query, 'url').to_s))

    # screenshots of windows
    when ['GET', '/windows']
      json(client, list_windows)
    when ['POST', '/capture']
      id = query.to_s[/(?:\A|&)id=(\d{1,10})/, 1]
      png = id && mac? ? capture_window(id) : nil
      png ? respond(client, 200, 'image/png', png) : respond(client, 415, 'text/plain', 'macOS did not allow the screenshot')
    when ['POST', '/screen-settings']
      system('open', SCREEN_SETTINGS, out: File::NULL, err: File::NULL) if mac?
      json(client, ok: true)

    # the end
    when ['POST', '/done']
      data = begin
        JSON.parse(body)
      rescue JSON::ParserError
        nil
      end
      bytes = data && data['png'].to_s.unpack1('m')
      unless bytes && bytes.start_with?("\x89PNG".b)
        respond(client, 400, 'text/plain', 'not a png')
        next
      end
      FileUtils.mkdir_p(File.dirname(out))
      File.binwrite(out, bytes)
      pages = clean_pages(data['pages'], out)
      json(client, ok: true, path: out)
      client.close
      emit(ok: true, path: out, note: data['note'].to_s.strip[0, 4000], notes: clean_notes(data['notes']), pages: pages)
      exit 0
    when ['POST', '/cancel']
      json(client, ok: true)
      client.close
      emit(cancelled: true, reason: 'cancelled in the window')
      exit 0
    when ['POST', '/gone']
      json(client, ok: true)
      gone_at = Time.now
    else
      respond(client, 404, 'text/plain', 'not found')
    end
  rescue StandardError => e
    $stderr.puts("sketch window: #{e.class}: #{e.message}")
    begin
      json(client, { ok: false, error: e.message }, 400) unless client.closed?
    rescue StandardError
      nil
    end
  ensure
    client.close unless client.closed?
  end
end

# sketch notes: turns what was drawn in the /sketch pane into a png, over a loaded image when there is one.
#
#   ruby sketch.rb --check IMAGE           json {ok, width, height} when the image can be read
#   ruby sketch.rb --grid IMAGE W H        the image fitted into a W x H pixel grid, as json
#                                          {grid: 3 hex digits (rgb) a pixel, row by row}
#   ruby sketch.rb --export OUT < JSON     draws the strokes (over the image) and writes OUT as a png,
#                                          prints json {path, width, height}
#   ruby sketch.rb --save-b64 OUT < B64    writes base64 from stdin to OUT (a pasted image)
#
# the export json is {image: path or null, width: W, height: H, strokes: [{c, s, p}]}:
# W x H is the canvas grid, c a color "#rrggbb" or "erase", s the brush width in grid pixels,
# p the points as x, y, x, y ... each from 0 to 10000 across the canvas.
#
# images are read through macOS `sips`, or ImageMagick's `magick` where there is no sips,
# so any format those read works (png, jpeg, heic, gif, tiff, webp, bmp).

require 'json'
require 'zlib'
require 'open3'
require 'tmpdir'
require 'fileutils'

UNIT = 10_000.0
LONG_SIDE = 1600

def fail_json(message)
  puts JSON.generate(ok: false, error: message)
  exit 1
end

def tool
  @tool ||= if system('command -v sips >/dev/null 2>&1') then :sips
            elsif system('command -v magick >/dev/null 2>&1') then :magick
            else fail_json('reading images needs sips (macOS) or ImageMagick (magick)')
            end
end

def run(*argv)
  out, err, st = Open3.capture3(*argv)
  fail_json("#{argv.first} failed: #{(err.empty? ? out : err).strip[0, 300]}") unless st.success?
  out
end

def size_of(path)
  fail_json("no such file: #{path}") unless File.file?(path)
  if tool == :sips
    out = run('sips', '-g', 'pixelWidth', '-g', 'pixelHeight', path)
    w = out[/pixelWidth:\s*(\d+)/, 1]
    h = out[/pixelHeight:\s*(\d+)/, 1]
    fail_json("not an image sips can read: #{File.basename(path)}") unless w && h
    [w.to_i, h.to_i]
  else
    out = run('magick', 'identify', '-format', '%w %h', "#{path}[0]")
    out.split.map(&:to_i)
  end
end

# the image scaled to exactly w x h, as w * h * 3 bytes of rgb over white
def rgb_of(path, w, h)
  Dir.mktmpdir('sketch-notes') do |dir|
    bmp = File.join(dir, 'frame.bmp')
    if tool == :sips
      run('sips', '-s', 'format', 'bmp', '-z', h.to_s, w.to_s, path, '--out', bmp)
    else
      run('magick', "#{path}[0]", '-resize', "#{w}x#{h}!", '-define', 'bmp:format=bmp4', "BMP:#{bmp}")
    end
    read_bmp(File.binread(bmp), w, h)
  end
end

def read_bmp(d, want_w, want_h)
  fail_json('the converted image is not a bmp') unless d[0, 2] == 'BM'
  offset = d[10, 4].unpack1('V')
  header = d[14, 4].unpack1('V')
  w, h = d[18, 8].unpack('l<l<')
  bpp = d[28, 2].unpack1('v')
  compression = d[30, 4].unpack1('V')
  fail_json("unexpected bmp size #{w}x#{h}") unless w == want_w && h.abs == want_h
  top_down = h < 0
  h = h.abs
  masks = if compression == 3 || compression == 6
            header > 40 ? d[54, 16].unpack('V4') : d[54, 12].unpack('V3') + [0]
          elsif bpp == 32
            [0xff0000, 0xff00, 0xff, 0xff000000]
          end
  fail_json("unsupported bmp: #{bpp} bits") unless [24, 32].include?(bpp)
  stride = ((w * bpp + 31) / 32) * 4
  out = String.new(capacity: w * h * 3, encoding: Encoding::BINARY)
  shifts = masks && masks.map { |m| m.zero? ? 0 : (m & -m).bit_length - 1 }
  h.times do |row|
    src = top_down ? row : h - 1 - row
    line = d.byteslice(offset + src * stride, stride)
    if bpp == 24
      line.byteslice(0, w * 3).unpack('C*').each_slice(3) { |b, g, r| out << r.chr << g.chr << b.chr }
    else
      rm, gm, bm, am = masks
      rs, gs, bs, as = shifts
      line.byteslice(0, w * 4).unpack('V*').each do |px|
        r = (px & rm) >> rs
        g = (px & gm) >> gs
        b = (px & bm) >> bs
        a = am.zero? ? 255 : (px & am) >> as
        if a < 255 # over white
          r = (r * a + 255 * (255 - a)) / 255
          g = (g * a + 255 * (255 - a)) / 255
          b = (b * a + 255 * (255 - a)) / 255
        end
        out << r.chr << g.chr << b.chr
      end
    end
  end
  out
end

# where an iw x ih image sits inside a w x h box, kept whole and centred
def fit(iw, ih, w, h)
  k = [w.to_f / iw, h.to_f / ih].min
  fw = [[(iw * k).round, 1].max, w].min
  fh = [[(ih * k).round, 1].max, h].min
  [(w - fw) / 2, (h - fh) / 2, fw, fh]
end

# a w x h white canvas with the image fitted in it, as rgb bytes
def background(path, w, h)
  buf = ("\xff".b * 3) * (w * h)
  return buf unless path
  iw, ih = size_of(path)
  x, y, fw, fh = fit(iw, ih, w, h)
  img = rgb_of(path, fw, fh)
  fh.times { |row| buf[((y + row) * w + x) * 3, fw * 3] = img.byteslice(row * fw * 3, fw * 3) }
  buf
end

def png(buf, w, h)
  raw = String.new(capacity: (w * 3 + 1) * h, encoding: Encoding::BINARY)
  h.times { |y| raw << "\x00".b << buf.byteslice(y * w * 3, w * 3) }
  chunk = lambda do |type, data|
    [data.bytesize].pack('N') + type + data + [Zlib.crc32(type + data)].pack('N')
  end
  "\x89PNG\r\n\x1a\n".b +
    chunk.call('IHDR', [w, h, 8, 2, 0, 0, 0].pack('NNCCCCC')) +
    chunk.call('IDAT', Zlib::Deflate.deflate(raw, 6)) +
    chunk.call('IEND', ''.b)
end

def color_bytes(hex)
  h = hex.to_s.delete('#')
  h = h.chars.map { |c| c * 2 }.join if h.size == 3
  return nil unless h =~ /\A\h{6}\z/
  [h].pack('H*')
end

# a filled disc of radius r at (cx, cy), painted with `paint` (rgb bytes) or copied from `base`
def disc(buf, base, w, h, cx, cy, r, paint)
  r = 0.5 if r < 0.5
  y0 = [(cy - r).floor, 0].max
  y1 = [(cy + r).ceil, h - 1].min
  (y0..y1).each do |y|
    dy = y + 0.5 - cy
    span = r * r - dy * dy
    next if span < 0
    half = Math.sqrt(span)
    x0 = [(cx - half).round, 0].max
    x1 = [(cx + half).round - 1, w - 1].min
    next if x1 < x0
    off = (y * w + x0) * 3
    len = (x1 - x0 + 1) * 3
    buf[off, len] = paint ? paint * (x1 - x0 + 1) : base.byteslice(off, len)
  end
end

def draw(buf, base, w, h, k, strokes)
  strokes.each do |s|
    paint = s['c'] == 'erase' ? nil : (color_bytes(s['c']) || "\x11\x11\x11".b)
    r = [s['s'].to_f, 1].max * k / 2.0
    pts = Array(s['p']).each_slice(2).select { |pt| pt.size == 2 }.map { |x, y| [x / UNIT * w, y / UNIT * h] }
    next if pts.empty?
    disc(buf, base, w, h, pts[0][0], pts[0][1], r, paint)
    step = [r / 2.0, 1.0].max
    pts.each_cons(2) do |(ax, ay), (bx, by)|
      dist = Math.hypot(bx - ax, by - ay)
      n = (dist / step).ceil
      (1..n).each { |i| t = i.to_f / n; disc(buf, base, w, h, ax + (bx - ax) * t, ay + (by - ay) * t, r, paint) }
    end
  end
end

args = ARGV.dup
case args.shift
when '--check'
  path = File.expand_path(args.shift.to_s)
  w, h = size_of(path)
  puts JSON.generate(ok: true, path: path, width: w, height: h)
when '--grid'
  path = File.expand_path(args.shift.to_s)
  w = args.shift.to_i
  h = args.shift.to_i
  fail_json('grid size must be 1 to 512') unless (1..512).cover?(w) && (1..512).cover?(h)
  buf = background(path, w, h)
  # 4 bits a channel keeps the grid small enough to hand to the canvas
  hex = buf.unpack('C*').map { |c| (c >> 4).to_s(16) }.join
  puts JSON.generate(ok: true, grid: hex)
when '--export'
  out = File.expand_path(args.shift.to_s)
  spec = JSON.parse($stdin.read)
  gw = spec['width'].to_i
  gh = spec['height'].to_i
  fail_json('the canvas has no size') unless gw > 0 && gh > 0
  k = LONG_SIDE.to_f / [gw, gh].max
  w = (gw * k).round
  h = (gh * k).round
  image = spec['image'] && File.expand_path(spec['image'])
  base = background(image, w, h)
  buf = base.dup
  draw(buf, base, w, h, k, Array(spec['strokes']))
  FileUtils.mkdir_p(File.dirname(out))
  File.binwrite(out, png(buf, w, h))
  puts JSON.generate(ok: true, path: out, width: w, height: h)
when '--save-b64'
  out = File.expand_path(args.shift.to_s)
  FileUtils.mkdir_p(File.dirname(out))
  File.binwrite(out, $stdin.read.unpack1('m'))
  puts JSON.generate(ok: true, path: out)
else
  warn File.read(__FILE__).lines.take_while { |l| l.start_with?('#') }.join
  exit 2
end

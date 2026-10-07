import sys, os
from PIL import Image, ImageDraw
d, out = sys.argv[1], sys.argv[2]
files = sorted(f for f in os.listdir(d) if f.endswith('.jpg'))
ims = [Image.open(os.path.join(d, f)).convert('RGB') for f in files]
if not ims:
    sys.exit(0)
w, h = 130, int(130 * ims[0].height / ims[0].width)
cols = 9
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * (w + 4), rows * (h + 18)), (255, 0, 0))
for i, (f, im) in enumerate(zip(files, ims)):
    x, y = (i % cols) * (w + 4), (i // cols) * (h + 18)
    sheet.paste(im.resize((w, h)), (x, y + 16))
    ImageDraw.Draw(sheet).text((x + 3, y + 2), f"{int(f[:5])}ms", fill=(255, 255, 255))
sheet.save(out)

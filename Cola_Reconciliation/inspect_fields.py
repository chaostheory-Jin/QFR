"""Produce read-only inspection crops; never modifies the original invoice scans."""
from pathlib import Path
from PIL import Image, ImageDraw

source = Path(__file__).resolve().parent
destination = source.parent / 'output' / 'reconciliation' / 'inspection'
destination.mkdir(parents=True, exist_ok=True)
for path in sorted(source.glob('*.jpg')):
    with Image.open(path) as image:
        # These field locations are specific to this scanned form, not OCR input.
        invoice_id = image.crop((1800, 600, 2550, 950))
        invoice_id.resize((1500, 700)).save(destination / f'{path.stem}-id.png')
        amounts = image.crop((0, 2050, image.width, 3120))
        canvas = Image.new('RGB', (image.width, 1470), 'white')
        ImageDraw.Draw(canvas).text((20, 10), path.name, fill='black')
        canvas.paste(invoice_id, (0, 40))
        canvas.paste(amounts, (0, 400))
        canvas.save(destination / f'{path.stem}-fields.png')
print(destination)

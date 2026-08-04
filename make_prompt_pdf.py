from pathlib import Path
import textwrap

root = Path(__file__).resolve().parent
src = root / "FOCUS_BUDDY_REBUILD_PROMPT.md"
out = root / "Focus_Buddy_Rebuild_Prompt.pdf"

text = src.read_text(encoding="utf-8")
for old, new in {
    "\u2013": "-",
    "\u2014": "-",
    "\u2018": "'",
    "\u2019": "'",
    "\u201c": '"',
    "\u201d": '"',
    "\u2192": "->",
    "\u00a0": " ",
    "\u2026": "...",
    "\u2011": "-",
}.items():
    text = text.replace(old, new)
text = text.encode("latin-1", "replace").decode("latin-1")

W, H = 612, 792
LM, TM, BM = 54, 54, 54
BODY, CODE, HEAD, SUB = 10, 8.5, 16, 12
LINE = 13
pages = []
cur = []
y = H - TM
in_code = False


def add_line(s="", size=BODY, font="F1", leading=LINE):
    global y, cur
    if y < BM + leading:
        pages.append(cur)
        cur = []
        y = H - TM
    cur.append((font, size, LM, y, s))
    y -= leading


def add_wrapped(s, size=BODY, font="F1", leading=LINE, width=88):
    if not s:
        add_line("", size, font, leading)
        return
    indent = len(s) - len(s.lstrip(" "))
    chunks = textwrap.wrap(
        s,
        width=max(20, width - indent),
        replace_whitespace=False,
        drop_whitespace=False,
    )
    if not chunks:
        add_line("", size, font, leading)
        return
    for i, part in enumerate(chunks):
        add_line((" " * indent if i else "") + part.strip(), size, font, leading)


for raw in text.splitlines():
    line = raw.rstrip("\n")
    if line.strip().startswith("```"):
        in_code = not in_code
        add_line("", BODY, "F1", 6)
        continue
    if in_code:
        add_wrapped(line, CODE, "F2", 11, 92)
    elif line.startswith("# "):
        y -= 4
        add_wrapped(line[2:].strip(), HEAD, "F3", 20, 58)
        y -= 4
    elif line.startswith("## "):
        y -= 5
        add_wrapped(line[3:].strip(), SUB, "F3", 16, 72)
    elif line.startswith("- "):
        add_wrapped("* " + line[2:].strip(), BODY, "F1", LINE, 84)
    else:
        add_wrapped(line.strip(), BODY, "F1", LINE, 88)

if cur:
    pages.append(cur)

objects = []


def obj(body):
    objects.append(body)
    return len(objects)


def esc(s):
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


font1 = obj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
font2 = obj("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>")
font3 = obj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")
page_ids = []
content_ids = []

for page in pages:
    stream = "\n".join(
        f"BT /{font} {size} Tf {x} {yy} Td ({esc(s)}) Tj ET"
        for font, size, x, yy, s in page
    )
    content_id = obj(
        f"<< /Length {len(stream.encode('latin-1'))} >>\n"
        f"stream\n{stream}\nendstream"
    )
    content_ids.append(content_id)
    page_ids.append(obj(""))

pages_id = len(objects) + 1
for idx, page_id in enumerate(page_ids):
    objects[page_id - 1] = (
        f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {W} {H}] "
        f"/Resources << /Font << /F1 {font1} 0 R /F2 {font2} 0 R /F3 {font3} 0 R >> >> "
        f"/Contents {content_ids[idx]} 0 R >>"
    )

kids = " ".join(f"{pid} 0 R" for pid in page_ids)
pages_obj = obj(f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>")
catalog = obj(f"<< /Type /Catalog /Pages {pages_obj} 0 R >>")

pdf = bytearray(b"%PDF-1.4\n")
offsets = [0]
for i, body in enumerate(objects, 1):
    offsets.append(len(pdf))
    pdf.extend(f"{i} 0 obj\n".encode("latin-1"))
    pdf.extend(body.encode("latin-1"))
    pdf.extend(b"\nendobj\n")

xref = len(pdf)
pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("latin-1"))
pdf.extend(b"0000000000 65535 f \n")
for off in offsets[1:]:
    pdf.extend(f"{off:010d} 00000 n \n".encode("latin-1"))
pdf.extend(
    f"trailer\n<< /Size {len(objects) + 1} /Root {catalog} 0 R >>\n"
    f"startxref\n{xref}\n%%EOF\n".encode("latin-1")
)

out.write_bytes(pdf)
print(f"wrote {out}")
print(f"{len(pdf)} bytes, {len(pages)} pages")

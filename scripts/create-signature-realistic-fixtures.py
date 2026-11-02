from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from PIL import Image, ImageDraw, ImageFont
from copy import deepcopy
import os, subprocess, pikepdf

out = "test-results"
os.makedirs(out, exist_ok=True)
font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
bold_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

# Letterhead image used in the repeating Word header.
letterhead = Image.new("RGBA", (1200, 150), (255, 255, 255, 0))
draw = ImageDraw.Draw(letterhead)
draw.rounded_rectangle((8, 8, 1188, 142), radius=18, fill=(18, 32, 58, 255))
draw.text((38, 28), "IRPA  |  IMPROVEMENT OF RANGELAND IN PASTORAL AREAS",
          font=ImageFont.truetype(bold_path, 28), fill=(255, 255, 255, 255))
draw.text((40, 82), "LONGIDO • ARUSHA • TANZANIA",
          font=ImageFont.truetype(font_path, 18), fill=(235, 240, 248, 255))
letterhead_path = os.path.join(out, "irpa-letterhead.png")
letterhead.save(letterhead_path)

# Transparent, faint watermark artwork embedded in the DOCX header.
watermark = Image.new("RGBA", (1000, 240), (255, 255, 255, 0))
wd = ImageDraw.Draw(watermark)
wd.text((25, 40), "IRPA • CONTROLLED MINUTES",
        font=ImageFont.truetype(bold_path, 82), fill=(90, 110, 140, 28))
watermark_path = os.path.join(out, "irpa-watermark-transparent.png")
watermark.save(watermark_path)

doc = Document()
section = doc.sections[0]
section.top_margin = Inches(1.05)
section.bottom_margin = Inches(.65)
section.left_margin = Inches(.78)
section.right_margin = Inches(.78)
normal = doc.styles["Normal"]
normal.font.name = "DejaVu Sans"
normal.font.size = Pt(10)
normal.font.color.rgb = RGBColor(35, 43, 55)
normal._element.rPr.rFonts.set(qn("w:eastAsia"), "DejaVu Sans")

header = section.header
header.is_linked_to_previous = False
p = header.paragraphs[0]
p.paragraph_format.space_after = Pt(0)
p.add_run().add_picture(letterhead_path, width=Inches(6.85))
watermark_paragraph = header.add_paragraph()
watermark_paragraph.paragraph_format.space_before = Pt(0)
watermark_paragraph.paragraph_format.space_after = Pt(0)
watermark_run = watermark_paragraph.add_run()
inline = watermark_run.add_picture(watermark_path, width=Inches(6.2), height=Inches(1.5))._inline
anchor = OxmlElement("wp:anchor")
for key, value in {
    "distT": "0", "distB": "0", "distL": "0", "distR": "0",
    "simplePos": "0", "relativeHeight": "0", "behindDoc": "1",
    "locked": "0", "layoutInCell": "1", "allowOverlap": "1"
}.items():
    anchor.set(key, value)
simple_pos = OxmlElement("wp:simplePos")
simple_pos.set("x", "0")
simple_pos.set("y", "0")
position_h = OxmlElement("wp:positionH")
position_h.set("relativeFrom", "page")
horizontal_alignment = OxmlElement("wp:align")
horizontal_alignment.text = "center"
position_h.append(horizontal_alignment)
position_v = OxmlElement("wp:positionV")
position_v.set("relativeFrom", "page")
vertical_offset = OxmlElement("wp:posOffset")
vertical_offset.text = str(int(4.0 * 914400))
position_v.append(vertical_offset)
effect_extent = OxmlElement("wp:effectExtent")
for edge in ("l", "t", "r", "b"):
    effect_extent.set(edge, "0")
wrap_none = OxmlElement("wp:wrapNone")
anchor.extend([
    simple_pos, position_h, position_v, deepcopy(inline.extent),
    effect_extent, wrap_none, deepcopy(inline.docPr),
    deepcopy(inline.cNvGraphicFramePr), deepcopy(inline.graphic)
])
inline.addnext(anchor)
inline.getparent().remove(inline)

def paragraph(text, bold=False):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(5)
    p.paragraph_format.line_spacing = 1.08
    r = p.add_run(text)
    r.bold = bold
    r.font.name = "DejaVu Sans"
    r.font.size = Pt(10)
    r._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), "DejaVu Sans")
    return p

for page in range(1, 4):
    title = doc.add_paragraph()
    title.paragraph_format.space_before = Pt(8)
    title.paragraph_format.space_after = Pt(8)
    run = title.add_run(f"OFFICIAL MEETING MINUTES — PAGE {page}")
    run.bold = True
    run.font.name = "DejaVu Sans"
    run.font.size = Pt(15)
    run.font.color.rgb = RGBColor(18, 32, 58)
    paragraph(f"Document reference: IRPA/MIN/2026/0{page}  |  Meeting date: 02 November 2026")
    paragraph("Agenda item: Sustainable rangeland governance, livestock development and community market access.")
    paragraph("The meeting considered implementation responsibilities, the evidence register, decisions, accountable officers and reporting deadlines.")
    paragraph(f"PAGE {page} BODY CONTENT LINE 1 — The official minutes retain their original layout and embedded letterhead.")
    paragraph(f"PAGE {page} BODY CONTENT LINE 2 — The record includes decisions, action owners and completion dates.")
    paragraph(f"PAGE {page} BODY CONTENT LINE 3 — All signatories must review the source document before applying a signature.")
    paragraph(f"PAGE {page} BODY CONTENT LINE 4 — The final page contains the approval and signature register.")
    if page == 3:
        paragraph("FINAL PAGE — APPROVAL AND SIGNATURE REGISTER", True)
        table = doc.add_table(rows=1, cols=3)
        table.style = "Table Grid"
        cells = table.rows[0].cells
        cells[0].text = "Officer / Role"
        cells[1].text = "Decision / Responsibility"
        cells[2].text = "Signature / Date"
        for values in [
            ("Meeting Chair", "Approval of official minutes", "________________"),
            ("Board Secretary", "Verification of proceedings", "________________"),
            ("Executive Director", "Confirmation and release", "________________"),
        ]:
            row = table.add_row().cells
            for cell, value in zip(row, values):
                cell.text = value
        paragraph("PAGE 3 SIGNATURE TABLE END — CONTROLLED DOCUMENT ACCEPTANCE FIXTURE", True)
    if page < 3:
        doc.add_page_break()

docx_path = os.path.join(out, "irpa-three-page-controlled-minutes.docx")
doc.save(docx_path)
subprocess.run(["libreoffice", "--headless", "--convert-to", "pdf", "--outdir", out, docx_path], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
pdf_path = os.path.join(out, "irpa-three-page-controlled-minutes.pdf")
with pikepdf.open(pdf_path) as pdf:
    if len(pdf.pages) != 3:
        raise RuntimeError(f"LibreOffice fixture expected 3 pages, got {len(pdf.pages)}")

    # Add a genuine Form XObject watermark containing an image XObject with a soft mask.
    wm = Image.new("RGBA", (160, 80), (0, 0, 0, 0))
    draw = ImageDraw.Draw(wm)
    draw.text((8, 15), "IRPA", font=ImageFont.truetype(bold_path, 36), fill=(70, 90, 120, 34))
    rgb = wm.convert("RGB")
    alpha = wm.getchannel("A")
    image = pdf.make_stream(rgb.tobytes())
    image.update({
        "/Type": pikepdf.Name("/XObject"), "/Subtype": pikepdf.Name("/Image"),
        "/Width": wm.width, "/Height": wm.height,
        "/ColorSpace": pikepdf.Name("/DeviceRGB"), "/BitsPerComponent": 8
    })
    soft_mask = pdf.make_stream(alpha.tobytes())
    soft_mask.update({
        "/Type": pikepdf.Name("/XObject"), "/Subtype": pikepdf.Name("/Image"),
        "/Width": wm.width, "/Height": wm.height,
        "/ColorSpace": pikepdf.Name("/DeviceGray"), "/BitsPerComponent": 8
    })
    image["/SMask"] = soft_mask
    if "/SMask" not in image or image["/SMask"]["/Subtype"] != pikepdf.Name("/Image"):
        raise RuntimeError("The second fixture must contain an image soft mask.")
    form = pdf.make_stream(b"q\n430 0 0 215 82 315 cm\n/WM Do\nQ\n")
    form.update({
        "/Type": pikepdf.Name("/XObject"), "/Subtype": pikepdf.Name("/Form"),
        "/FormType": 1, "/BBox": pikepdf.Array([0, 0, 595, 842]),
        "/Resources": pikepdf.Dictionary(XObject=pikepdf.Dictionary(WM=image))
    })
    if form["/Subtype"] != pikepdf.Name("/Form"):
        raise RuntimeError("The second fixture watermark must be a Form XObject.")
    for page in pdf.pages:
        resources = page.obj.get("/Resources", pikepdf.Dictionary())
        xobjects = resources.get("/XObject", pikepdf.Dictionary())
        xobjects["/IRPAWatermarkForm"] = form
        resources["/XObject"] = xobjects
        page.obj["/Resources"] = resources
        prefix = pdf.make_stream(b"q /IRPAWatermarkForm Do Q\n")
        existing = page.obj.get("/Contents")
        page.obj["/Contents"] = pikepdf.Array([prefix, existing]) if existing is not None else prefix

    softmask_path = os.path.join(out, "irpa-three-page-form-xobject-softmask.pdf")
    pdf.save(softmask_path)

print("DOCX:", docx_path)
print("PDF:", pdf_path)
print("SOFTMASK_FORM_XOBJECT_PDF:", softmask_path)
print("PAGES:", len(pikepdf.open(pdf_path).pages))

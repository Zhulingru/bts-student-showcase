#!/usr/bin/env python3
"""
Generate an A3 poster template PPTX for BTS Student Showcase.

Design concept: 科技 × 人文 · Code Meets Culture
- Warm cream paper background, deep-ink navy typography, antique gold accents
- Serif Chinese × Mono Latin type mix for editorial + systematic feel
- 5 numbered sections: 01 Works · 02 Process · 03/04/05 Text · 06 Feedback

Output: ~/Desktop/BTS_專題海報_A3範本.pptx
"""

from pptx import Presentation
from pptx.util import Cm, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.oxml.ns import qn
from lxml import etree
import os

# ---------- Slide size (A3 portrait) ----------
SLIDE_W_CM = 29.7
SLIDE_H_CM = 42.0

# ---------- Palette ----------
INK   = RGBColor(0x14, 0x1E, 0x30)   # 深墨藍：主要文字
PAPER = RGBColor(0xF5, 0xF1, 0xE8)   # 溫暖紙色：底色
GOLD  = RGBColor(0xB8, 0x8C, 0x3D)   # 霧金：強調
TEAL  = RGBColor(0x3D, 0x6B, 0x7A)   # 湖水藍：次強調
MUTED = RGBColor(0x8A, 0x82, 0x76)   # 暖灰：提示文字
FRAME = RGBColor(0xC9, 0xC0, 0xAB)   # 卡其：照片框線
CREAM = RGBColor(0xEC, 0xE5, 0xD1)   # 淺卡其：照片填色
QRBG  = RGBColor(0xFF, 0xFF, 0xFF)   # 白：QR 底

# ---------- Fonts ----------
F_SERIF     = "Noto Serif TC"
F_SERIF_EN  = "Playfair Display"
F_SANS      = "Noto Sans TC"
F_SANS_EN   = "Inter"
F_MONO      = "JetBrains Mono"


# ---------- Low-level helpers ----------
def _strip_style(shape):
    """Remove the preset p:style so we're not fighting the theme."""
    sp = shape._element
    for s in sp.findall(qn('p:style')):
        sp.remove(s)


def _set_dash(shape, dash_val):
    ln = shape.line._get_or_add_ln()
    for existing in ln.findall(qn('a:prstDash')):
        ln.remove(existing)
    prstDash = etree.SubElement(ln, qn('a:prstDash'))
    prstDash.set('val', dash_val)


def add_rect(slide, x, y, w, h, fill=None, line_color=None, line_pt=None, dash=None):
    shp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, w, h)
    _strip_style(shp)
    if fill is None:
        shp.fill.background()
    else:
        shp.fill.solid()
        shp.fill.fore_color.rgb = fill
    if line_color is None:
        shp.line.fill.background()
    else:
        shp.line.color.rgb = line_color
        if line_pt is not None:
            shp.line.width = Pt(line_pt)
        if dash is not None:
            _set_dash(shp, dash)
    return shp


def add_hrule(slide, x, y, w, color=INK, thickness_pt=0.5):
    """Solid thin horizontal rule via a filled rectangle."""
    h = Emu(int(thickness_pt * 12700))
    shp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, w, h)
    _strip_style(shp)
    shp.fill.solid()
    shp.fill.fore_color.rgb = color
    shp.line.fill.background()
    return shp


def add_vrule(slide, x, y, h, color=INK, thickness_pt=0.5):
    w = Emu(int(thickness_pt * 12700))
    shp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, w, h)
    _strip_style(shp)
    shp.fill.solid()
    shp.fill.fore_color.rgb = color
    shp.line.fill.background()
    return shp


def _set_ea(run, name):
    """Set East Asian typeface on a run so CJK renders in the chosen serif/sans."""
    rPr = run._r.get_or_add_rPr()
    for ea in rPr.findall(qn('a:ea')):
        rPr.remove(ea)
    ea = etree.SubElement(rPr, qn('a:ea'))
    ea.set('typeface', name)


def _set_spc(run, spc_val):
    """Character tracking, hundredths of a point."""
    rPr = run._r.get_or_add_rPr()
    rPr.set('spc', str(spc_val))


def add_text(slide, x, y, w, h, paragraphs, align=PP_ALIGN.LEFT,
             anchor=MSO_ANCHOR.TOP, spacing=1.2, margin_cm=0.05):
    """
    paragraphs: list of paragraphs; each paragraph is a list of runs.
                A run is a dict with keys:
                text, font (latin), ea_font, size, bold, italic, color, spc, align
    Or: a single flat list of runs for a single-paragraph textbox.
    """
    tb = slide.shapes.add_textbox(x, y, w, h)
    tf = tb.text_frame
    tf.word_wrap = True
    m = Cm(margin_cm)
    tf.margin_left = m
    tf.margin_right = m
    tf.margin_top = m
    tf.margin_bottom = m
    tf.vertical_anchor = anchor

    if paragraphs and isinstance(paragraphs[0], dict):
        paragraphs = [paragraphs]

    for i, para in enumerate(paragraphs):
        if i == 0:
            p = tf.paragraphs[0]
        else:
            p = tf.add_paragraph()
        p.alignment = align
        p.line_spacing = spacing

        for r in para:
            run = p.add_run()
            run.text = r.get('text', '')
            f = run.font
            latin = r.get('font', F_SANS_EN)
            f.name = latin
            f.size = Pt(r.get('size', 10))
            f.bold = r.get('bold', False)
            f.italic = r.get('italic', False)
            f.color.rgb = r.get('color', INK)
            _set_ea(run, r.get('ea_font', F_SANS))
            if 'spc' in r:
                _set_spc(run, r['spc'])
    return tb


# ---------- Sections ----------
def draw_background(slide):
    # Full-bleed paper
    add_rect(slide, Cm(0), Cm(0), Cm(SLIDE_W_CM), Cm(SLIDE_H_CM), fill=PAPER)


def draw_corner_marks(slide):
    """Small '+' registration marks at each corner — subtle print-design cue."""
    def mark(cx, cy):
        length = Cm(0.35)
        thick = 0.6
        add_hrule(slide, cx - length / 2, cy, length, color=INK, thickness_pt=thick)
        add_vrule(slide, cx, cy - length / 2, length, color=INK, thickness_pt=thick)

    off = Cm(0.7)
    mark(off, off)
    mark(Cm(SLIDE_W_CM) - off, off)
    mark(off, Cm(SLIDE_H_CM) - off)
    mark(Cm(SLIDE_W_CM) - off, Cm(SLIDE_H_CM) - off)


def draw_header(slide):
    # Eyebrow left
    add_text(
        slide, Cm(1.5), Cm(1.15), Cm(20), Cm(0.5),
        [{
            'text': '//  BTS · STUDENT SHOWCASE  ·  2026 SUMMER  ·  114T3 EXHIBITION',
            'font': F_MONO, 'ea_font': F_SANS,
            'size': 8, 'color': MUTED, 'spc': 200,
        }],
    )
    # Eyebrow right (concept badge · index)
    add_text(
        slide, Cm(1.5), Cm(1.15), Cm(SLIDE_W_CM - 3), Cm(0.5),
        [{
            'text': 'CODE  ×  CULTURE   ·   N°—   ·   A3 · 297 × 420 mm',
            'font': F_MONO, 'ea_font': F_MONO,
            'size': 8, 'color': GOLD, 'spc': 300, 'bold': True,
        }],
        align=PP_ALIGN.RIGHT,
    )
    # Top gold rule
    add_hrule(slide, Cm(1.5), Cm(1.7), Cm(SLIDE_W_CM - 3), color=GOLD, thickness_pt=0.75)

    # Big project title (placeholder)
    add_text(
        slide, Cm(1.5), Cm(2.05), Cm(SLIDE_W_CM - 3), Cm(1.8),
        [{
            'text': '在此輸入專題題目',
            'font': F_SERIF_EN, 'ea_font': F_SERIF,
            'size': 40, 'color': INK, 'bold': False,
        }],
        spacing=1.05,
    )

    # Subtitle (english / tagline)
    add_text(
        slide, Cm(1.5), Cm(3.95), Cm(SLIDE_W_CM - 3), Cm(0.9),
        [{
            'text': '副標 · Subtitle or a one-line tagline for your project',
            'font': F_SERIF_EN, 'ea_font': F_SERIF,
            'size': 14, 'color': MUTED, 'italic': True,
        }],
    )

    # Meta chips
    meta_y = Cm(5.05)
    meta_h = Cm(0.55)
    meta_x = Cm(1.5)
    chip_w = Cm(8.6)
    labels = [
        ('STUDENT',    '學生姓名'),
        ('CLASS',      'A / B 班'),
        ('SUPERVISOR', 'Chibi 老師'),
    ]
    for i, (en, zh) in enumerate(labels):
        x = meta_x + Cm(i * (8.6 + 0.3))
        # small label
        add_text(
            slide, x, meta_y, chip_w, Cm(0.35),
            [{
                'text': en,
                'font': F_MONO, 'ea_font': F_MONO,
                'size': 7, 'color': GOLD, 'spc': 400, 'bold': True,
            }],
        )
        # value
        add_text(
            slide, x, meta_y + Cm(0.32), chip_w, Cm(0.55),
            [{
                'text': zh,
                'font': F_SERIF_EN, 'ea_font': F_SERIF,
                'size': 13, 'color': INK,
            }],
        )

    # Header closing rule (ink)
    add_hrule(slide, Cm(1.5), Cm(6.15), Cm(SLIDE_W_CM - 3), color=INK, thickness_pt=0.5)


def draw_section_label(slide, y_cm, number, zh_title, en_title, hint):
    """Reusable section header with a big serif number and mixed titles."""
    # Big serif number
    add_text(
        slide, Cm(1.5), Cm(y_cm - 0.15), Cm(2.6), Cm(1.4),
        [{
            'text': number,
            'font': F_SERIF_EN, 'ea_font': F_SERIF_EN,
            'size': 34, 'color': GOLD,
        }],
        spacing=1.0,
    )
    # Chinese title
    add_text(
        slide, Cm(4.1), Cm(y_cm), Cm(12), Cm(0.9),
        [{
            'text': zh_title,
            'font': F_SERIF_EN, 'ea_font': F_SERIF,
            'size': 20, 'color': INK,
        }],
    )
    # English subtitle
    add_text(
        slide, Cm(4.1), Cm(y_cm + 0.85), Cm(12), Cm(0.5),
        [{
            'text': en_title,
            'font': F_MONO, 'ea_font': F_MONO,
            'size': 8, 'color': MUTED, 'spc': 300,
        }],
    )
    # Right-aligned hint
    add_text(
        slide, Cm(1.5), Cm(y_cm + 0.9), Cm(SLIDE_W_CM - 3), Cm(0.45),
        [{
            'text': hint,
            'font': F_MONO, 'ea_font': F_SANS,
            'size': 8, 'color': TEAL, 'spc': 200,
        }],
        align=PP_ALIGN.RIGHT,
    )


def draw_photo_placeholder(slide, x, y, w, h, label_en, label_zh):
    """Cream box with dashed frame + centered caption. Students paste photos over it."""
    # Fill
    add_rect(slide, x, y, w, h, fill=CREAM)
    # Dashed frame
    add_rect(slide, x, y, w, h, line_color=FRAME, line_pt=0.75, dash='dash')

    # Center label
    cap_h = Cm(1.1)
    add_text(
        slide, x, y + (h - cap_h) / 2, w, cap_h,
        [
            [{
                'text': label_en,
                'font': F_MONO, 'ea_font': F_MONO,
                'size': 8, 'color': MUTED, 'spc': 400, 'bold': True,
            }],
            [{
                'text': label_zh,
                'font': F_SERIF_EN, 'ea_font': F_SERIF,
                'size': 10, 'color': MUTED, 'italic': True,
            }],
        ],
        align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, spacing=1.3,
    )


def draw_works_section(slide):
    y0 = 14.4
    draw_section_label(
        slide, y_cm=y0,
        number='04',
        zh_title='作品照片',
        en_title='WORKS  ·  4  KEY IMAGES',
        hint='TIP  ·  建議 3:2 或 4:3 · 首張放主圖 · 高解析度',
    )
    # 2×2 photo grid
    grid_x = Cm(1.5)
    grid_y = Cm(y0 + 1.55)
    total_w = Cm(SLIDE_W_CM - 3)
    total_h = Cm(12.8)
    gap = Cm(0.35)
    cell_w = (total_w - gap) / 2
    cell_h = (total_h - gap) / 2

    for r in range(2):
        for c in range(2):
            idx = r * 2 + c + 1
            x = grid_x + c * (cell_w + gap)
            y = grid_y + r * (cell_h + gap)
            draw_photo_placeholder(
                slide, x, y, cell_w, cell_h,
                label_en=f'PHOTO  ·  {idx:02d}',
                label_zh='拖曳作品照片至此',
            )


def draw_process_section(slide):
    y0 = 29.2
    draw_section_label(
        slide, y_cm=y0,
        number='05',
        zh_title='創作歷程',
        en_title='PROCESS  ·  8  SNAPSHOTS  ·  CHRONOLOGICAL',
        hint='TIP  ·  依時間順序 · 過程草稿／討論／半成品都可',
    )
    # 4×2 small photo grid
    grid_x = Cm(1.5)
    grid_y = Cm(y0 + 1.55)
    total_w = Cm(SLIDE_W_CM - 3)
    total_h = Cm(7.2)
    gap = Cm(0.25)
    cell_w = (total_w - 3 * gap) / 4
    cell_h = (total_h - gap) / 2

    for r in range(2):
        for c in range(4):
            idx = r * 4 + c + 1
            x = grid_x + c * (cell_w + gap)
            y = grid_y + r * (cell_h + gap)
            draw_photo_placeholder(
                slide, x, y, cell_w, cell_h,
                label_en=f'STEP  {idx:02d}',
                label_zh='歷程 · 照片',
            )


def draw_text_columns(slide):
    y0 = 6.7  # 緊接 header 分隔線之後
    # 每欄自己就是一個 section（01/02/03），三欄並列於上半部
    body_y = Cm(y0)
    body_h = Cm(7.2)
    col_gap = Cm(0.6)
    col_w = (Cm(SLIDE_W_CM - 3) - 2 * col_gap) / 3

    blocks = [
        {
            'num': '01',
            'zh': '專題製作動機',
            'en': 'MOTIVATION',
            'quote': '“為什麼想做這件事？”',
            'body': (
                '在此撰寫你的專題動機。可以從一件觸動你的事、'
                '一個好奇的問題、或一個想解決的困擾開始寫起。\n\n'
                '參考結構：\n'
                '▸ 起心動念——最初的靈感\n'
                '▸ 中間轉折——為何堅持\n'
                '▸ 為什麼是現在\n\n'
                '用第一人稱寫，建議 100–150 字。'
            ),
        },
        {
            'num': '02',
            'zh': '專題簡介',
            'en': 'OVERVIEW',
            'quote': '“你做了什麼？怎麼做？”',
            'body': (
                '在此簡介你的作品：主題、形式與亮點。\n\n'
                '參考結構：\n'
                '▸ 一句話說明作品\n'
                '▸ 形式與媒材（影片／裝置／文字…）\n'
                '▸ 使用的技術或工具\n'
                '▸ 最想被看到的那一點\n\n'
                '避免流水帳，挑重點寫。建議 100–150 字。'
            ),
        },
        {
            'num': '03',
            'zh': '心得感想',
            'en': 'REFLECTION',
            'quote': '“做完之後，你變得不一樣了嗎？”',
            'body': (
                '在此撰寫做完專題後的思考。\n\n'
                '參考結構：\n'
                '▸ 我學到什麼\n'
                '▸ 我卡關在哪裡、怎麼解決\n'
                '▸ 如果重來一次會怎麼改\n'
                '▸ 給下一屆的一句話建議\n\n'
                '誠實寫下失敗與轉折。建議 100–150 字。'
            ),
        },
    ]

    for i, b in enumerate(blocks):
        x = Cm(1.5) + i * (col_w + col_gap)
        # Column number
        add_text(
            slide, x, body_y, col_w, Cm(1.1),
            [{
                'text': b['num'],
                'font': F_SERIF_EN, 'ea_font': F_SERIF_EN,
                'size': 22, 'color': GOLD,
            }],
        )
        # Chinese title
        add_text(
            slide, x + Cm(1.4), body_y + Cm(0.05), col_w - Cm(1.4), Cm(0.8),
            [{
                'text': b['zh'],
                'font': F_SERIF_EN, 'ea_font': F_SERIF,
                'size': 14, 'color': INK, 'bold': True,
            }],
        )
        # English label
        add_text(
            slide, x + Cm(1.4), body_y + Cm(0.75), col_w - Cm(1.4), Cm(0.4),
            [{
                'text': b['en'],
                'font': F_MONO, 'ea_font': F_MONO,
                'size': 7, 'color': TEAL, 'spc': 400, 'bold': True,
            }],
        )
        # Divider
        add_hrule(slide, x, body_y + Cm(1.3), col_w, color=INK, thickness_pt=0.4)
        # Pull quote
        add_text(
            slide, x, body_y + Cm(1.5), col_w, Cm(0.8),
            [{
                'text': b['quote'],
                'font': F_SERIF_EN, 'ea_font': F_SERIF,
                'size': 11, 'color': GOLD, 'italic': True,
            }],
        )
        # Body — split on newlines so line breaks actually render
        body_paragraphs = []
        for line in b['body'].split('\n'):
            body_paragraphs.append([{
                'text': line if line else ' ',
                'font': F_SERIF_EN, 'ea_font': F_SERIF,
                'size': 10, 'color': INK,
            }])
        add_text(
            slide, x, body_y + Cm(2.4), col_w, body_h - Cm(2.4),
            body_paragraphs,
            spacing=1.4,
        )


def draw_footer(slide):
    y0 = 38.6
    # Top rule
    add_hrule(slide, Cm(1.5), Cm(y0), Cm(SLIDE_W_CM - 3), color=INK, thickness_pt=0.5)

    # Left: 06 · FEEDBACK label & description
    add_text(
        slide, Cm(1.5), Cm(y0 + 0.25), Cm(3.0), Cm(1.2),
        [{
            'text': '06',
            'font': F_SERIF_EN, 'ea_font': F_SERIF_EN,
            'size': 30, 'color': GOLD,
        }],
    )
    add_text(
        slide, Cm(4.1), Cm(y0 + 0.35), Cm(15), Cm(0.7),
        [{
            'text': '回饋表單',
            'font': F_SERIF_EN, 'ea_font': F_SERIF,
            'size': 16, 'color': INK, 'bold': True,
        }],
    )
    add_text(
        slide, Cm(4.1), Cm(y0 + 1.05), Cm(15), Cm(0.45),
        [{
            'text': 'FEEDBACK  ·  SCAN THE QR CODE',
            'font': F_MONO, 'ea_font': F_MONO,
            'size': 8, 'color': MUTED, 'spc': 300,
        }],
    )
    add_text(
        slide, Cm(4.1), Cm(y0 + 1.55), Cm(16), Cm(0.9),
        [{
            'text': '掃描右方 QR Code，寫下你對這件作品的想法。',
            'font': F_SERIF_EN, 'ea_font': F_SERIF,
            'size': 10, 'color': INK, 'italic': True,
        }],
    )

    # Right: QR placeholder
    qr_size = Cm(2.4)
    qr_x = Cm(SLIDE_W_CM - 1.5) - qr_size
    qr_y = Cm(y0 + 0.3)
    # Label above the QR box (avoids overlap with bottom credit line)
    add_text(
        slide, qr_x - Cm(4.0), qr_y - Cm(0.05), Cm(4.0) + qr_size, Cm(0.4),
        [{
            'text': '掃描 · SCAN  ▶',
            'font': F_MONO, 'ea_font': F_SANS,
            'size': 9, 'color': GOLD, 'spc': 300, 'bold': True,
        }],
        align=PP_ALIGN.RIGHT,
    )
    add_rect(slide, qr_x, qr_y, qr_size, qr_size, fill=QRBG,
             line_color=INK, line_pt=0.75)
    # Inner "QR" hint
    add_text(
        slide, qr_x, qr_y, qr_size, qr_size,
        [
            [{
                'text': 'QR',
                'font': F_MONO, 'ea_font': F_MONO,
                'size': 22, 'color': INK, 'bold': True, 'spc': 400,
            }],
            [{
                'text': '貼上 QR Code',
                'font': F_SERIF_EN, 'ea_font': F_SERIF,
                'size': 8, 'color': MUTED, 'italic': True,
            }],
        ],
        align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, spacing=1.3,
    )

    # Bottom-most credit strip
    add_text(
        slide, Cm(1.5), Cm(SLIDE_H_CM - 1.1), Cm(SLIDE_W_CM - 3), Cm(0.4),
        [{
            'text': '//  BTS · STUDENT SHOWCASE  ·  CURATED FOR PROJECT-BASED LEARNING  ·  A3 · 297 × 420 mm',
            'font': F_MONO, 'ea_font': F_MONO,
            'size': 7, 'color': MUTED, 'spc': 300,
        }],
        align=PP_ALIGN.CENTER,
    )


def draw_side_concept_mark(slide):
    """Small vertical concept mark on the right edge — CODE × CULTURE."""
    tb = slide.shapes.add_textbox(Cm(SLIDE_W_CM - 1.15), Cm(9.0), Cm(0.9), Cm(9.0))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = 0
    tf.margin_right = 0
    tf.margin_top = 0
    tf.margin_bottom = 0
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    run = p.add_run()
    run.text = 'CODE  ×  CULTURE'
    run.font.name = F_MONO
    run.font.size = Pt(9)
    run.font.color.rgb = MUTED
    _set_ea(run, F_MONO)
    _set_spc(run, 800)
    # Rotate the textbox 90° CW so text reads bottom-to-top on the right edge
    sp = tb._element
    spPr = sp.find('.//' + qn('p:spPr'))
    xfrm = spPr.find(qn('a:xfrm'))
    if xfrm is None:
        xfrm = etree.SubElement(spPr, qn('a:xfrm'))
    xfrm.set('rot', str(270 * 60000))  # 270° in 60000ths of a degree


def build_poster(out_path):
    prs = Presentation()
    prs.slide_width = Cm(SLIDE_W_CM)
    prs.slide_height = Cm(SLIDE_H_CM)
    blank = prs.slide_layouts[6]  # blank layout
    slide = prs.slides.add_slide(blank)

    draw_background(slide)
    draw_corner_marks(slide)
    draw_header(slide)
    draw_works_section(slide)
    draw_process_section(slide)
    draw_text_columns(slide)
    draw_footer(slide)

    prs.save(out_path)
    return out_path


if __name__ == '__main__':
    desktop = os.path.expanduser('~/Desktop')
    out = os.path.join(desktop, 'BTS_專題海報_A3範本.pptx')
    build_poster(out)
    print(f'Saved: {out}')

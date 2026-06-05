"""Stage 4 — MusicXML → SVG (browser display) + PDF (download) via Verovio.

Verovio is a C++ music notation renderer with Python bindings (pip install verovio).
It is the same engine used by the Verovio Humdrum Viewer and many other
professional music notation tools.

Layout strategy
---------------
We use ``adjustPageHeight=1`` so Verovio renders the entire score onto a
single tall "page". The resulting SVG height adapts to the score length,
which is perfect for web display: the user scrolls vertically through the
whole piece without pagination.

PDF generation
--------------
Attempt order:
  1. Verovio's renderToFile() with a .pdf path (available in v3.14+).
  2. cairosvg SVG→PDF conversion.
  3. Empty string (pipeline continues; PDF download disabled in UI).
"""

from __future__ import annotations

import base64
import os
import re
import tempfile
import time
import xml.etree.ElementTree as ET

import structlog
import verovio

logger = structlog.get_logger()

# Verovio layout options for web display (scroll-friendly single page).
_DISPLAY_OPTIONS: dict = {
    "scale": 40,
    "pageWidth": 2100,
    "adjustPageHeight": 1,   # Adapt height to content → one tall SVG page
    "footer": "none",
    "header": "none",
    "pageMarginTop": 60,
    "pageMarginBottom": 60,
    "pageMarginLeft": 80,
    "pageMarginRight": 80,
    "spacingSystem": 8,      # Vertical space between systems (staves)
    "spacingStaff": 8,
    "font": "Leipzig",        # Bundled Verovio music font
}

# Verovio layout options for A4 PDF output (multi-page friendly).
_PDF_OPTIONS: dict = {
    "scale": 40,
    "pageWidth": 2100,
    "pageHeight": 2970,      # A4 in tenths at scale 40
    "adjustPageHeight": 0,
    "footer": "none",
    "header": "none",
    "pageMarginTop": 100,
    "pageMarginBottom": 100,
    "pageMarginLeft": 150,
    "pageMarginRight": 150,
    "spacingSystem": 8,
    "spacingStaff": 8,
    "font": "Leipzig",
}


def run(music_xml: str) -> tuple[str, str, float]:
    """Render MusicXML to SVG and PDF.

    Args:
        music_xml: MusicXML document as a UTF-8 string.

    Returns:
        Tuple of (svg_string, pdf_b64_string, elapsed_seconds).
        ``pdf_b64_string`` may be empty if PDF generation fails — the
        pipeline does NOT fail in that case.

    Raises:
        ValueError: If Verovio cannot parse the MusicXML document.
    """
    t_start = time.perf_counter()

    # Strip DOCTYPE, XML namespace declarations, and normalise the version to
    # 3.1 before handing off to Verovio.  music21 9.x may emit xmlns:xlink
    # attributes and/or a version="4.0" header that Verovio 3.15 rejects.
    music_xml = _clean_musicxml(music_xml)

    # ------------------------------------------------------------------
    # Render to SVG (display)
    # ------------------------------------------------------------------
    tk = verovio.toolkit()
    tk.setOptions(_DISPLAY_OPTIONS)

    if not tk.loadData(music_xml):
        parse_error = None
        try:
            xml_tree = ET.fromstring(music_xml)
        except ET.ParseError as exc:
            parse_error = str(exc)
            xml_tree = None

        xml_note_count = 0
        xml_part_count = 0
        if xml_tree is not None:
            xml_part_count = len(xml_tree.findall('.//{*}part'))
            xml_note_count = len(xml_tree.findall('.//{*}note'))

        logger.debug(
            "verovio_load_failed",
            xml_bytes=len(music_xml),
            xml_head=music_xml[:400],
            parse_error=parse_error,
            part_count=xml_part_count,
            note_count=xml_note_count,
        )

        if parse_error:
            raise ValueError(
                "Verovio could not parse the MusicXML document. "
                f"XML parse error: {parse_error}"
            )
        if xml_part_count == 0 or xml_note_count == 0:
            raise ValueError(
                "Verovio could not parse the MusicXML document. "
                "The score appears to contain no parts or notes."
            )
        raise ValueError(
            "Verovio could not parse the MusicXML document. "
            "This may indicate a malformed or empty score."
        )

    # With adjustPageHeight=1 there is always exactly one page.
    svg = tk.renderToSVG(1)

    if not svg or len(svg) < 100:
        raise ValueError("Verovio produced an empty SVG output.")

    # ------------------------------------------------------------------
    # Render to PDF
    # ------------------------------------------------------------------
    pdf_b64 = _generate_pdf(music_xml, svg)

    elapsed = time.perf_counter() - t_start
    logger.debug(
        "render_complete",
        svg_bytes=len(svg),
        pdf_generated=(pdf_b64 != ""),
        elapsed_s=round(elapsed, 3),
    )
    return svg, pdf_b64, elapsed


# ---------------------------------------------------------------------------
# PDF generation helpers
# ---------------------------------------------------------------------------


def _generate_pdf(music_xml: str, svg_fallback: str) -> str:
    """Return a base64-encoded PDF, trying two methods in order."""
    pdf_b64 = _pdf_via_verovio(music_xml)
    if pdf_b64:
        return pdf_b64

    pdf_b64 = _pdf_via_cairosvg(svg_fallback)
    if pdf_b64:
        return pdf_b64

    logger.warning("pdf_generation_failed", reason="all methods exhausted")
    return ""


def _pdf_via_verovio(music_xml: str) -> str:
    """Attempt PDF generation using Verovio's renderToFile (v3.14+).

    Verovio infers the output format from the file extension.
    """
    pdf_path = ""
    try:
        tk = verovio.toolkit()
        tk.setOptions(_PDF_OPTIONS)
        tk.loadData(music_xml)

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            pdf_path = f.name

        success = tk.renderToFile(pdf_path)
        if not success:
            return ""

        with open(pdf_path, "rb") as f:
            data = f.read()

        if len(data) < 100:  # Sanity check — Verovio may write an empty file
            return ""

        return base64.b64encode(data).decode("utf-8")

    except Exception as exc:
        logger.debug("pdf_verovio_failed", reason=str(exc))
        return ""
    finally:
        if pdf_path:
            try:
                os.unlink(pdf_path)
            except OSError:
                pass


def _pdf_via_cairosvg(svg: str) -> str:
    """Convert SVG → PDF using cairosvg (requires libcairo2 system library)."""
    try:
        import cairosvg  # type: ignore[import-untyped]

        pdf_bytes = cairosvg.svg2pdf(bytestring=svg.encode("utf-8"))
        return base64.b64encode(pdf_bytes).decode("utf-8")

    except ImportError:
        logger.debug("pdf_cairosvg_unavailable")
        return ""
    except Exception as exc:
        logger.debug("pdf_cairosvg_failed", reason=str(exc))
        return ""


def _clean_musicxml(xml: str) -> str:
    """Normalise MusicXML for maximum Verovio compatibility.

    music21 9.x may emit:
    - A <!DOCTYPE> declaration that Verovio does not need and sometimes rejects.
    - xmlns:xlink (and other namespace) declarations on <score-partwise> that
      Verovio 3.15 does not understand.
    - version="4.0" in the root element; Verovio has best support for 3.1.
    """
    # Remove DOCTYPE declaration (handles single-line and internal-subset forms)
    xml = re.sub(r'<!DOCTYPE\b.*?(?:\]>|>)', '', xml, flags=re.DOTALL)
    # Remove XML namespace declarations: xmlns="..." and xmlns:foo="..."
    xml = re.sub(r'\s+xmlns(?::[a-zA-Z]\w*)?\s*=\s*"[^"]*"', '', xml)
    # Normalise MusicXML version to 3.1 in the <score-partwise> root element
    xml = re.sub(r'(<score-partwise\b[^>]*)version="[^"]*"', r'\1version="3.1"', xml)
    return xml.strip()

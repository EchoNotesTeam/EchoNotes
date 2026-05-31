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
import tempfile
import time

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

    # ------------------------------------------------------------------
    # Render to SVG (display)
    # ------------------------------------------------------------------
    tk = verovio.toolkit()
    tk.setOptions(_DISPLAY_OPTIONS)

    if not tk.loadData(music_xml):
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

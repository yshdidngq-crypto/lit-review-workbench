"""Apply the review changes to the existing standalone 174-paper preview."""
from pathlib import Path
import sys


def replace_script(html: str, marker: str, source: str) -> str:
    at = html.index(marker)
    start = html.rfind("<script>", 0, at)
    end = html.index("</script>", at) + len("</script>")
    if start < 0:
        raise ValueError(f"Script start missing: {marker}")
    return html[:start] + "<script>\n" + source.rstrip() + "\n</script>" + html[end:]


def main() -> None:
    baseline, output = map(Path, sys.argv[1:3])
    scripts = Path(__file__).parent
    html = baseline.read_text(encoding="utf-8")
    html = replace_script(
        html,
        "const key = (A.CFG.lsKey || 'lit-workbench-v1') + ':library-organizer-v1'",
        (scripts / "library_panel.js").read_text(encoding="utf-8"),
    )
    html = replace_script(
        html,
        "/* Preview layer: three-pane literature workspace for the existing single-file UI. */",
        (scripts / "library_workspace.js").read_text(encoding="utf-8"),
    )
    html = html.replace(
        "</body>",
        "<script>\n"
        + (scripts / "review_changes.js").read_text(encoding="utf-8").rstrip()
        + "\n</script>\n</body>",
        1,
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html, encoding="utf-8")
    print(f"Wrote {output}: {len(html):,} characters")


if __name__ == "__main__":
    main()

import fitz # PyMuPDF

def extract_text_pymupdf(pdf_path):
    """
    Extracts all text from a PDF file using PyMuPDF (fitz).
    """
    doc = fitz.open(pdf_path)
    text = ""
    for page in doc:
        text += page.get_text()
    doc.close()
    return text
#!/usr/bin/env python3
"""
Skrypt do generowania clauses_export.md z clauses.json
Konwertuje strukturę JSON na markdown z hierarchią artykułów i klauzul.
"""

import json
import re
from collections import defaultdict
from pathlib import Path

def natural_sort_key(clause_id):
    """Zwraca klucz sortowania dla numeracyjnego (naturalnego) sortowania klauzul."""
    # Format: U.7.1.1.a, U.7.1.1.b-01, C.5.1.3.1, itd.
    match = re.match(r'([UC])\.(.+)', clause_id)
    if not match:
        return (999, clause_id)
    
    clause_type = match.group(1)
    rest = match.group(2)  # np. "7.1.1.a" lub "5.1.3.1"
    
    # Rozbijamy na części, konwertując liczby na int dla prawidłowego sortowania
    parts = []
    for segment in rest.split('.'):
        # Część może być: "1", "a", "b-01", "01", itd.
        if segment.isdigit():
            parts.append((0, int(segment)))  # Liczby: (0, wartość)
        else:
            # Litery/znaki: (1, string) - pojawią się po liczbach
            parts.append((1, segment))
    
    return (0 if clause_type == 'U' else 1, parts)

def extract_article_info(clause_title):
    """Ekstrahuje numer artykułu i opisową część z tytułu klauzuli."""
    # Oczekiwany format: "U.7.1.1.a — Opisowa część (Art. 7 ...)"
    match = re.match(r'([UC])\.(\d+)', clause_title)
    if match:
        clause_type = match.group(1)
        article_num = match.group(2)
        return clause_type, article_num
    return None, None

def extract_article_name(clause_title):
    """Ekstrahuje nazwę artykułu z nawiasu w tytule."""
    # Szuka wzorca "(Art. ...)" na końcu tytułu
    match = re.search(r'\(Art\.\s+[^)]+\)', clause_title)
    if match:
        return match.group(0)
    return None

def format_markdown(data_list):
    """Konwertuje liste stringów/obiektów na sformatowany markdown."""
    lines = []
    for item in data_list:
        if isinstance(item, str):
            if item.startswith("**"):
                lines.append(f"  - {item}")
            else:
                lines.append(f"  - {item}")
        elif isinstance(item, dict) and item.get("type") == "test":
            title = item.get("title", "")
            desc = item.get("description", "")
            lines.append(f"  - **{title}**")
            lines.append(f"    - {desc}")
    return "\n".join(lines)

def build_article_labels():
    """Buduje mapowanie artykułów na ich opisowe nazwy z mapping.json."""
    try:
        with open('clauses_json/mapping.json', 'r', encoding='utf-8') as f:
            mapping = json.load(f)
        
        article_labels = {}
        seen_categories = set()
        
        for entry in mapping.get('matrix', []):
            legal_id = entry.get('legal_id', '')
            category = entry.get('category', '')
            
            if legal_id and category and legal_id not in article_labels:
                article_labels[legal_id] = category
        
        return article_labels
    except Exception as e:
        print(f"Uwaga: Nie udało się wczytać mapping.json ({e})")
        return {}

def generate_export_markdown():
    """Główna funkcja generująca markdown."""
    
    # Wczytanie danych
    with open('clauses_json/clauses.json', 'r', encoding='utf-8') as f:
        clauses = json.load(f)
    
    # Pobranie etykiet artykułów
    article_labels = build_article_labels()
    
    # Pogrupowanie klauzul
    sections = defaultdict(lambda: defaultdict(list))
    
    for clause_id, clause_data in clauses.items():
        clause_type, article_num = extract_article_info(clause_id)
        
        if clause_type and article_num:
            section_key = clause_type
            article_key = f"{article_num}"
            sections[section_key][article_key].append((clause_id, clause_data))
    
    # Generowanie markdown
    md_lines = []
    
    # Sekcja I: Klauzule prawne (U)
    if 'U' in sections:
        md_lines.append("## Klauzule prawne (U)")
        md_lines.append("")
        
        for article_num in sorted(sections['U'].keys(), key=lambda x: int(x)):
            clauses_in_article = sections['U'][article_num]
            # Sortuj klauzule wewnątrz artykułu
            clauses_in_article.sort(key=lambda x: natural_sort_key(x[0]))
            
            # Nagłówek artykułu - szukaj z mapping, jeśli nie ma to zbuduj z pierwszej klauzuli
            article_label = None
            for _, clause_data in clauses_in_article:
                for label_id, label in article_labels.items():
                    if label_id.startswith(f'U.{article_num}.'):
                        article_label = label
                        break
                if article_label:
                    break
            
            if not article_label:
                # Fallback: pobierz z tytułu pierwszej klauzuli
                first_title = clauses_in_article[0][1].get('title', '')
                art_pattern = re.search(r'\(Art\.\s+[\d\s.ust]+\)', first_title)
                if art_pattern:
                    article_label = f"Art. {article_num}"
                else:
                    article_label = f"Art. {article_num}"
            
            md_lines.append(f"### {article_label}")
            md_lines.append("")
            
            # Klauzule w artykule
            for clause_id, clause_data in clauses_in_article:
                title = clause_data.get('title', clause_id)
                evaluation = clause_data.get('evaluation', 'Brak oceny')
                procedure = clause_data.get('procedure', [])
                preconditions = clause_data.get('preconditions', [])
                checklist = clause_data.get('checklist', [])
                
                # Nagłówek klauzuli
                md_lines.append(f"#### {title}")
                
                # Warunki wstępne
                if preconditions and any(p.strip() for p in preconditions):
                    md_lines.append("- **Warunki wstępne:**")
                    for pre in preconditions:
                        if pre.strip():
                            md_lines.append(f"  - {pre}")
                
                # Ocena
                md_lines.append(f"- **Ocena:** {evaluation}")
                
                # Procedura
                if procedure and any(p.strip() for p in procedure):
                    md_lines.append("- **Procedura / opis:**")
                    for proc in procedure:
                        if proc.strip():
                            # Jeśli zawiera numery odsyłacze (1., 2. itd), formatuj as subitems
                            if re.match(r'^\d+\.', proc):
                                md_lines.append(f"  - {proc}")
                            else:
                                md_lines.append(f"  - {proc}")
                
                # Lista kontrolna / testy
                if checklist:
                    md_lines.append("- **Lista kontrolna / testy:**")
                    for item in checklist:
                        if isinstance(item, str):
                            if item.strip():
                                if item.startswith("**") and item.endswith("**:"):
                                    md_lines.append(f"  - {item}")
                                else:
                                    md_lines.append(f"  - {item}")
                        elif isinstance(item, dict) and item.get("type") == "test":
                            title_item = item.get("title", "")
                            desc_item = item.get("description", "")
                            md_lines.append(f"  - **{title_item}**")
                            md_lines.append(f"    - {desc_item}")
                
                md_lines.append("")
    
    # Sekcja II: Klauzule techniczne (C)
    if 'C' in sections:
        md_lines.append("## Klauzule techniczne (C)")
        md_lines.append("")
        
        # Sortowanie numeryczne: C.5 < C.10 < C.11
        def article_sort_key(article_str):
            parts = article_str.split('.')
            return tuple(int(p) if p.isdigit() else 999 for p in parts)
        
        for article_num in sorted(sections['C'].keys(), key=article_sort_key):
            clauses_in_article = sections['C'][article_num]
            # Sortuj klauzule wewnątrz artykułu
            clauses_in_article.sort(key=lambda x: natural_sort_key(x[0]))
            
            # Nagłówek artykułu
            first_title = clauses_in_article[0][1].get('title', '')
            art_pattern = re.search(r'\(C\.\s+[\d.]+', first_title)
            if art_pattern:
                article_label = f"Norma EN 301 549 {article_num}"
            else:
                article_label = f"C.{article_num}"
            
            md_lines.append(f"### {article_label}")
            md_lines.append("")
            
            # Klauzule w artykule
            for clause_id, clause_data in clauses_in_article:
                title = clause_data.get('title', clause_id)
                evaluation = clause_data.get('evaluation', 'Brak oceny')
                procedure = clause_data.get('procedure', [])
                preconditions = clause_data.get('preconditions', [])
                checklist = clause_data.get('checklist', [])
                
                # Nagłówek klauzuli
                md_lines.append(f"#### {title}")
                
                # Warunki wstępne
                if preconditions and any(p.strip() for p in preconditions):
                    md_lines.append("- **Warunki wstępne:**")
                    for pre in preconditions:
                        if pre.strip():
                            md_lines.append(f"  - {pre}")
                
                # Ocena
                md_lines.append(f"- **Ocena:** {evaluation}")
                
                # Procedura
                if procedure and any(p.strip() for p in procedure):
                    md_lines.append("- **Procedura / opis:**")
                    for proc in procedure:
                        if proc.strip():
                            md_lines.append(f"  - {proc}")
                
                # Lista kontrolna / testy
                if checklist:
                    md_lines.append("- **Lista kontrolna / testy:**")
                    for item in checklist:
                        if isinstance(item, str):
                            if item.strip():
                                md_lines.append(f"  - {item}")
                        elif isinstance(item, dict) and item.get("type") == "test":
                            title_item = item.get("title", "")
                            desc_item = item.get("description", "")
                            md_lines.append(f"  - **{title_item}**")
                            md_lines.append(f"    - {desc_item}")
                
                md_lines.append("")
    
    return "\n".join(md_lines)

if __name__ == '__main__':
    try:
        markdown = generate_export_markdown()
        
        with open('clauses_export.md', 'w', encoding='utf-8') as f:
            f.write(markdown)
        
        print("✅ Plik clauses_export.md został wygenerowany pomyślnie!")
        print(f"   Rozmiar: {len(markdown)} znaków")
        
    except Exception as e:
        print(f"❌ Błąd: {e}")
        import traceback
        traceback.print_exc()

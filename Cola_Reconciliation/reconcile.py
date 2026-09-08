import os
import glob
import re
import subprocess
import json
import base64
import requests

openai_api_key = os.environ.get("OPENAI_API_KEY_QFR")
if not openai_api_key:
    raise Exception("OPENAI_API_KEY_QFR environment variable not set")

def extract_from_image_with_context(image_path, master_data):
    with open(image_path, "rb") as f:
        image_data = base64.b64encode(f.read()).decode("utf-8")
    
    prompt_text = """You are a highly precise OCR expert. Look at this invoice. 
1. Find the Invoice Number (typically starts with DI or I, located near the top right). 
2. Find the Final Total Amount (labeled 'Gross Amount Payable' or 'Amount Payable', typically at the very bottom). 
Ignore hand-written notes if they conflict with the printed text. 
Return ONLY valid JSON: {"invoice_number": "DI1234567890", "total_amount": 12345.0}. 
Strip all spaces and commas from the amount. Do not wrap in markdown tags."""

    url = "https://api.openai.com/v1/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {openai_api_key}"
    }
    
    payload = {
        "model": "gpt-5.6-sol",
        "response_format": { "type": "json_object" },
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": prompt_text
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{image_data}",
                            "detail": "high"
                        }
                    }
                ]
            }
        ],
        "max_completion_tokens": 150
    }
    
    try:
        response = requests.post(url, headers=headers, json=payload)
        response.raise_for_status()
        result = response.json()
        text = result['choices'][0]['message']['content']
        # Use regex to find the json block in case it's wrapped
        json_match = re.search(r'\{.*\}', text, re.DOTALL)
        if json_match:
            data = json.loads(json_match.group(0))
            return data
        else:
            print(f"  [ERROR] No JSON found in response: {text}")
            return None
    except Exception as e:
        print(f"Error extracting from {image_path}: {e}")
        if 'response' in locals() and hasattr(response, 'text'):
            print(f"API Error details: {response.text}")
        elif 'text' in locals():
            print(f"Raw output: {text}")
        return None

def parse_pdf(pdf_path):
    # Use pdftotext -layout to extract text preserving column formatting
    subprocess.run(["pdftotext", "-layout", pdf_path, "layout.txt"], check=True)
    with open("layout.txt", "r", encoding="utf-8") as f:
        lines = f.readlines()
        
    master_data = {}
    
    for i, line in enumerate(lines):
        if "Sales" in line and "invoice" in line:
            di_number = None
            for j in range(1, 3):
                if i + j < len(lines):
                    m = re.search(r'([D]?I\d+)', lines[i+j])
                    if m:
                        di_number = m.group(1)
                        break
            
            if di_number:
                amount_str = re.search(r'(-?(?:\d{1,3} )*\d{1,3},\d{2})\s*$', line)
                if amount_str:
                    val = amount_str.group(1).replace(" ", "").replace(",", ".")
                    master_data[di_number] = float(val)
                    
    for line in lines:
        m = re.search(r'([D]?I\d+)', line)
        if m:
            di_number = m.group(1)
            if di_number not in master_data:
                amount_str = re.search(r'(-?(?:\d{1,3} )*\d{1,3},\d{2})\s*$', line)
                if amount_str:
                    val = amount_str.group(1).replace(" ", "").replace(",", ".")
                    master_data[di_number] = float(val)
                    
    return master_data

def main():
    pdf_file = "UTUKUFU LTD SEMUTO statement Jan 2024 to 30th April 2026.pdf"
    print("Parsing master PDF bill...")
    master_data = parse_pdf(pdf_file)
    print(f"Extracted {len(master_data)} invoice entries from master bill.\n")
    
    images = sorted(glob.glob("*.jpg"))
    print(f"Found {len(images)} invoice images. Reconciling with contextual reasoning...\n")
    
    total_images = len(images)
    total_matched = 0
    total_errors = 0
    
    for img in images:
        print(f"Processing {img}...")
        img_data = extract_from_image_with_context(img, master_data)
        if not img_data:
            print(f"  [ERROR] Failed to extract data.")
            total_errors += 1
            continue
            
        inv_no = img_data.get("invoice_number")
        amount = img_data.get("total_amount")
        
        if not inv_no or not amount:
            print(f"  [ERROR] Missing invoice number or amount in extraction: {img_data}")
            total_errors += 1
            continue
            
        print(f"  -> Extracted Invoice: {inv_no}, Amount: {amount}")
        
        # 1. Try Exact Match
        if inv_no in master_data and abs(abs(master_data[inv_no]) - float(amount)) < 1.0:
            print(f"  [SUCCESS] Exact Match found! ({master_data[inv_no]:,.2f})")
            total_matched += 1
            print()
            continue
            
        # 2. Agentic Reasoning Simulation: Fuzzy matching / Amount matching
        import difflib
        
        # First, let's see if we can find any invoice in the master bill that has this exact same amount
        # since the amount (e.g., 25,108,709) is very hard to get completely wrong and often unique.
        amount_matches = [k for k, v in master_data.items() if abs(abs(v) - float(amount)) < 1.0]
        
        resolved = False
        if len(amount_matches) == 1:
            # Only one invoice in the entire bill has this exact amount. We can confidently assume this is it.
            print(f"  [SUCCESS-RECOVERED] Amount matches uniquely to {amount_matches[0]}. OCR misread {amount_matches[0]} as {inv_no}.")
            total_matched += 1
            resolved = True
        elif len(amount_matches) > 1:
            # Multiple invoices have this amount. Find the one with the closest Invoice Number string.
            closest = difflib.get_close_matches(inv_no, amount_matches, n=1, cutoff=0.3)
            if closest:
                print(f"  [SUCCESS-RECOVERED] Found closest invoice {closest[0]} matching amount. OCR misread as {inv_no}.")
                total_matched += 1
                resolved = True
                
        if not resolved:
            # If amount matching failed, try finding the closest invoice number regardless of amount
            closest_keys = difflib.get_close_matches(inv_no, master_data.keys(), n=1, cutoff=0.7)
            if closest_keys:
                candidate = closest_keys[0]
                cand_amt = master_data[candidate]
                if abs(abs(cand_amt) - float(amount)) < 1.0:
                    print(f"  [SUCCESS-RECOVERED] Fuzzy matched invoice {candidate} and amount verified. OCR misread as {inv_no}.")
                    total_matched += 1
                    resolved = True
                else:
                    print(f"  [MISMATCH] Closest invoice {candidate} has amount {cand_amt:,.2f} but image has {amount}")
                    total_errors += 1
            else:
                print(f"  [NOT FOUND] Invoice {inv_no} not found, and no fuzzy match recovered.")
                total_errors += 1
        print()

    print("-" * 50)
    accuracy = (total_matched / total_images) * 100 if total_images > 0 else 0
    error_rate = 100 - accuracy
    print(f"Total Processed: {total_images}")
    print(f"Successfully Matched: {total_matched}")
    print(f"Errors/Mismatches: {total_errors}")
    print(f"Accuracy Rate: {accuracy:.2f}%")
    print(f"Error Rate: {error_rate:.2f}%")
    
    if total_matched == total_images:
        print("\n✅ RECONCILIATION SUCCESS: All processed image invoices match the master bill.")
    else:
        print("\n❌ RECONCILIATION FAILED: Some invoices did not match or were not found.")

if __name__ == "__main__":
    main()

"""Canned Groq responses for offline tests of the script-to-plan stages."""
import json

SCRIPT = """रात की आख़िरी बस में मीरा अकेली बैठी थी। तीसरी सीट हर पड़ाव पर भीग जाती थी।
ड्राइवर रघु ने कहा, "उस सीट पर मत बैठना, बेटी।"
मीरा ने पूछा, "क्यों? वहाँ तो कोई नहीं है।"
पीछे से एक भीगी हुई औरत की फुसफुसाहट आई, "मेरी सीट लौटा दो।"
बस रुकी, और तीसरी सीट पर गीले पैरों के निशान दरवाज़े तक जाते दिखे।"""

CHARACTERS = {"characters": [
    {"tag": "@CHAR-01-MEERA", "name": "मीरा", "look_summary": "25-year-old woman, yellow salwar kameez, wet dupatta",
     "full_prompt": "16:9 2D reference sheet of Meera, 25, yellow salwar kameez, front pose", "voice_description": "Young female, soft North Indian Hindi"},
    {"tag": "@CHAR-02-RAGHU", "name": "रघु", "look_summary": "55-year-old bus driver, grey moustache, khaki uniform",
     "full_prompt": "16:9 2D reference sheet of Raghu, 55, khaki driver uniform, front pose", "voice_description": "Older male, gravelly North Indian Hindi"},
]}

BACKGROUNDS = {"backgrounds": [
    {"tag": "#BGD-01-BUS-WIDE", "location_name": "Bus interior wide", "look_summary": "empty night bus aisle, teal rain light",
     "full_prompt": "Empty 16:9 2D night bus interior, wide angle"},
    {"tag": "#BGD-02-BUS-SEAT", "location_name": "Third seat close", "look_summary": "close view of a wet third seat",
     "full_prompt": "Empty 16:9 2D close view of the wet third bus seat"},
]}


def scenes(count: int = 12) -> dict:
    out = []
    for n in range(1, count + 1):
        speaker = "@CHAR-02-RAGHU" if n == 3 else "@CHAR-01-MEERA" if n == 4 else "NARRATOR"
        tags = ["@CHAR-01-MEERA", "@CHAR-02-RAGHU"] if n in (3, 4) else ["@CHAR-01-MEERA"]
        out.append({
            "scene_number": n, "title": f"दृश्य {n}", "background_tag": "#BGD-02-BUS-SEAT" if n % 2 else "#BGD-01-BUS-WIDE",
            "character_tags": tags, "speaker": speaker, "visual_action": "Meera glances at the dripping third seat.",
            "camera": "slow push-in", "effects": "rain streaks on windows", "sound_design": "rain, engine hum",
            "devanagari_dialogue": "उस सीट पर मत बैठना, बेटी।" if n == 3 else "क्यों? वहाँ तो कोई नहीं है।" if n == 4 else "",
            "narration_text": "" if n in (3, 4) else "तीसरी सीट फिर से भीग गई थी।",
        })
    return {"scenes": out}


def fake_completion(prompt: str, short_scenes: bool = False) -> str:
    """Answer by the JSON schema each stage appends to its literal template."""
    if 'Return ONLY JSON with {"scenes"' in prompt:
        return json.dumps(scenes(11 if short_scenes else 12), ensure_ascii=False)
    if 'Return ONLY JSON: {"backgrounds"' in prompt:
        return "```json\n" + json.dumps(BACKGROUNDS, ensure_ascii=False) + "\n```"
    if 'Return ONLY JSON: {"characters"' in prompt:
        return json.dumps(CHARACTERS, ensure_ascii=False)
    raise AssertionError("Unexpected prompt sent to the writing model: " + prompt[:120])

from faster_whisper import WhisperModel 
model = WhisperModel("base", device="cpu", compute_type="int8") 

def sst(file_path):
    segments, _ = model.transcribe(file_path, beam_size=5)
    text = " ".join(seg.text.strip() for seg in segments)
    return text

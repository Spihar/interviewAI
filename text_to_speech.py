import pyttsx3
def tts(text):
    engine = pyttsx3.init()
    voices = engine.getProperty('voices')

    engine.setProperty('rate', 150)
    engine.setProperty('voice', voices[1].id)
    engine.say(text)
    engine.runAndWait()
    return
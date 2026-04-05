import sounddevice as sd # thin Python wrapper around PortAudio
import numpy as np 
from scipy.io.wavfile import write # for saving the recorded audio to a WAV file
from faster_whisper import WhisperModel #. A reimplementation of OpenAI's Whisper model using CTranslate2 instead of PyTorch.
import tempfile, os # for creating and managing temporary files

model = WhisperModel("base", device="cpu", compute_type="int8") 
# Load the "base" Whisper model, which is a smaller version of the original model, optimized for CPU inference with 8-bit integer precision.
# int8 -- Uses ~4× less memory with negligible accuracy loss. 
def speech_to_text():
    fs = 16000 #16,000 audio samples captured per second.
    frames = [] 
    ''' 
    a callback function is a function that is passed as an argument to another function 
    and is intended to be called at a later time when a specific event occurs. 
    In this case, the callback function is used to process audio data as it is being recorded.
    '''
    def callback(indata, frame_count, time_info, status): 
        '''
        This function is called by the sounddevice library whenever new audio data is available. 
        It receives the audio data in the indata parameter, 
        which is a NumPy array containing the recorded audio samples. 
        The frame_count parameter indicates how many audio frames were captured, 
        time_info provides timing information about the recording, 
        and status contains any error or warning messages related to the audio stream. 
        In this callback function, we append a copy of the recorded audio data to the frames list for later processing.
        '''
        frames.append(indata.copy())

    input("🎤 Press ENTER to start...")
    print("   Recording... press ENTER to stop.")
    # The with statement is used to create a context in which the audio stream is active.
    # The sd.InputStream function is called to create an input audio stream with the specified parameters:
    with sd.InputStream(samplerate=fs, channels=1,
                        dtype="int16", callback=callback):
        input()
    # callback --- registers your function to receive audio chunks.

    # After the recording is stopped, we concatenate all the recorded audio frames into a single NumPy array using np.concatenate.
    audio = np.concatenate(frames, axis=0)

    # We create a temporary file with a .wav extension to save the recorded audio.
    '''
    NamedTemporaryFile creates a uniquely named file like tmpxk3p9q.wav in the OS temp folder. delete=False means it won't auto-delete when closed.
        We close the file immediately after creating it because we only need the filename to save our audio data.
        write() fills that file with proper WAV format — header with sample rate/bit depth info, then the raw audio samples.
    '''
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    write(tmp.name, fs, audio)

    '''
    beam_size=5 means at each token generation step, 
    it keeps the 5 most likely sequences in parallel and picks the best one at the end. 
    Higher = more accurate, slower. beam_size=1 is greedy (fastest).

    '''
    try:
        segments, _ = model.transcribe(tmp.name, beam_size=5)
        text = " ".join(seg.text.strip() for seg in segments)
        return text
    finally:
        os.remove(tmp.name)

text = speech_to_text()
print(f"{text}")
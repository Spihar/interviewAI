const API_BASE = "http://127.0.0.1:8000"
let session_id = "";
let mediaRecorder;
let audioChunks = [];

// Start a new interview session on page load
window.onload = () => {
    startSession();
}

async function startSession() {
    const res = await fetch(`${API_BASE}/start_interview`, {
        method: "POST"
    });
    const data = await res.json();
    session_id = data.session_id;
    console.log("Session ID:", session_id);
}

async function uploadResume() {
    const fileInput = document.getElementById("resumeFile");
    const file = fileInput.files[0];
    if (!file) { 
        alert("Select a file first"); return; 
    }
    const formData = new FormData(); 
    formData.append("file", file);
    try {
        const res = await fetch(`${API_BASE}/upload_resume?session_id=${session_id}`, {
            method: "POST",
            body: formData
        });

        const data = await res.json();

        //document.getElementById("context").value = data.extracted_text;

    } catch (err) {
        console.error(err);
        alert("Upload failed");
    }

    }

async function askAI() {
    console.log("Asking AI...");

    const user = document.getElementById("history").value || "";

    try {
        const res = await fetch(`${API_BASE}/interview`, {
            method: "POST",
            headers: {

                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                session_id: session_id,
                user:user,
            })
        });

        const data = await res.json();
        if (data.error) {
        alert(data.error);
        return;
        }


        const chat = document.getElementById("chat");
chat.innerHTML += `
    <div class="bg-gray-900 rounded-xl p-5 border border-gray-800">
        <p class="text-gray-400 text-sm mb-1">You said</p>
        <p class="mb-3">${user}</p>
        <p class="text-blue-400 text-sm mb-1">AI Question</p>
        <p class="mb-3">${data.question}</p>
        <div class="flex gap-4 text-sm">
            <span class="text-gray-400">Feedback: <span class="text-white">${data.feedback}</span></span>
            <span class="text-gray-400">Score: <span class="text-green-400 font-bold">${data.score}/10</span></span>
        </div>
    </div>
`;

    } catch (err) {
        console.error(err);
        alert("Request failed");
    }

    }

async function endInterview() {
    const res =await fetch(`${API_BASE}/end_interview`,{
        method : "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            session_id: session_id,
            user: ""
        })
    });
    const data = await res.json();
    chat.innerHTML += `
    <div class="bg-gray-900 rounded-xl p-5 border border-gray-800">
        <p class="text-gray-400 text-sm mb-1">You said</p>
        <p class="mb-3">${user}</p>
        <p class="text-blue-400 text-sm mb-1">AI Question</p>
        <p class="mb-3">${data.question}</p>
        <div class="flex gap-4 text-sm">
            <span class="text-gray-400">Feedback: <span class="text-white">${data.feedback}</span></span>
            <span class="text-gray-400">Score: <span class="text-green-400 font-bold">${data.score}/10</span></span>
        </div>
    </div>
`;
    
}

// start recording 
async function startRecording(){
    audioChunks = [];
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (event) => {
        audioChunks.push(event.data);
    };
    mediaRecorder.start();

}

// Stop recording and send audio to backend for transcription
function stopRecording(){
    // Stop the media recorder and process the audio
    if (!mediaRecorder) return;
    mediaRecorder.stop();
    mediaRecorder.onstop = async () => {
        try {
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
            const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
            const formData = new FormData();
            formData.append("file", audioBlob, "recording.webm");

            document.getElementById("history").value = "Transcribing...";
            
            const res = await fetch(`${API_BASE}/speech_to_text`, {
                method: "POST",
                body: formData
            });
            const data = await res.json();
            document.getElementById("history").value = data.text;

        }
        catch (err) {
            console.error(err);
            alert("Transcription failed");
        }
        audioChunks = [];
    };

}
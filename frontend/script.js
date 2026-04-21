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
        <div style="margin-bottom:10px;">
            <p><b>You:</b> ${user}</p>
            <p><b>AI Question:</b> ${data.question}</p>
            <p><b>Feedback:</b> ${data.feedback}</p>
            <p><b>Score:</b> ${data.score}/10</p>
            <hr/>
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
    document.getElementById("chat").innerHTML += `
        <hr>
        <h3>Final Report</h3>
        <p>Total Questions: ${data.total_questions}</p>
        <p>Average Score: ${data.average_score}/10</p>
        <p>Status: ${data.status}</p>
    `;
    
}

// start recording 
async function startRecording(){
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (event) => {
        audioChunks.push(event.data);
    };
    mediaRecorder.start();

}

// Stop recording and send audio to backend for transcription
function stopRecording(){
    mediaRecorder.stop();
    mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: "audio/webm" });

        const formData = new FormData();
        formData.append("file", audioBlob, "recording.webm");

        const res = await fetch(`${API_BASE}/speech_to_text`, {
            method: "POST",
            body: formData
        });
        const data = await res.json();
        document.getElementById("history").value = data.text;
        audioChunks = [];
    };

}
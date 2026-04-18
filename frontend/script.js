const API_BASE = "http://127.0.0.1:8000"
let session_id = "";

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


    document.getElementById("response").innerText = data.response;

} catch (err) {
    console.error(err);
    alert("Request failed");
}

}


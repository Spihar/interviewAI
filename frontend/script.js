const API_BASE = "http://127.0.0.1:8000"
let resume_text="";
let convo = []

async function uploadResume() {
const fileInput = document.getElementById("resumeFile");
const file = fileInput.files[0];
if (!file) { 
    alert("Select a file first"); return; 
}
const formData = new FormData(); 
formData.append("file", file);
try {
    const res = await fetch(`${API_BASE}/upload_resume`, {
        method: "POST",
        body: formData
    });

    const data = await res.json();

    //document.getElementById("context").value = data.extracted_text;
    resume_text = data.extracted_text;
    console.log(resume_text)

} catch (err) {
    console.error(err);
    alert("Upload failed");
}

}

async function askAI() {
if (!resume_text) {
    alert("Please upload a resume first"); return;
}

const user = document.getElementById("history").value || "";

try {
    const res = await fetch(`${API_BASE}/interview`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            context: resume_text,
            user:user,
            history: convo
        })
    });

    const data = await res.json();

    convo.push({
            ai: data.response,
            user:user
        });


    document.getElementById("response").innerText = data.response;

} catch (err) {
    console.error(err);
    alert("Request failed");
}

}


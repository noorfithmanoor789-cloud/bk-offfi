import { db } from './firebase.js';
import { collection, addDoc, getDocs, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { EXAM_STUDENTS, EXAM_QUESTIONS } from './data.js';

// ==================== CHECK INTERNET CONNECTION ====================
const isOnline = navigator.onLine;

// ==================== STATE MANAGEMENT ====================
let currentUser = null;
let currentQuestionIndex = 0;
let userAnswers = new Array(EXAM_QUESTIONS.length).fill(null);
let timer = null;
let timeLeft = 1200; // 20 minutes
let examStartTime = null;
let examEndTime = null;
let examSubmitted = false;

// ==================== OFFLINE RESULTS STORAGE ====================
// Each student's results are stored in their own browser localStorage
let offlineResults = JSON.parse(localStorage.getItem('offlineResults')) || [];

// ==================== DOM REFERENCES ====================
const loginSection = document.getElementById('loginSection');
const instructionsSection = document.getElementById('instructionsSection');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const startExamBtn = document.getElementById('startExamBtn');

// ==================== LOGIN FUNCTIONALITY ====================
if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value.trim();

        const student = EXAM_STUDENTS.find(s => s.username === username && s.password === password);

        if (student) {
            currentUser = student;
            localStorage.setItem('examUser', JSON.stringify(student));
            loginSection.style.display = 'none';
            instructionsSection.style.display = 'block';
            loginError.style.display = 'none';
            
            const welcomeMsg = document.getElementById('welcomeMessage');
            if (welcomeMsg) {
                welcomeMsg.textContent = `Welcome, ${student.name}!`;
            }
            
            // Show connection status
            const statusMsg = document.getElementById('connectionStatus');
            if (statusMsg) {
                if (navigator.onLine) {
                    statusMsg.textContent = '✅ Online - Results will be saved to Firebase';
                    statusMsg.style.background = '#d4edda';
                    statusMsg.style.color = '#155724';
                } else {
                    statusMsg.textContent = '📱 Offline - Results will be saved locally and synced later';
                    statusMsg.style.background = '#fff3cd';
                    statusMsg.style.color = '#856404';
                }
            }
        } else {
            loginError.textContent = 'Invalid username or password. Please try again.';
            loginError.style.display = 'block';
        }
    });
}

// ==================== START EXAM ====================
if (startExamBtn) {
    startExamBtn.addEventListener('click', () => {
        localStorage.setItem('examStarted', 'true');
        window.location.href = 'student/test.html';
    });
}

// ==================== EXAM LOGIC ====================
if (window.location.pathname.includes('test.html')) {
    const userData = JSON.parse(localStorage.getItem('examUser'));
    if (!userData) {
        window.location.href = '../index.html';
    }

    currentUser = userData;
    document.getElementById('studentNameDisplay').textContent = currentUser.name;
    document.getElementById('totalQNum').textContent = EXAM_QUESTIONS.length;

    displayQuestion(0);
    startTimer();

    document.getElementById('prevBtn')?.addEventListener('click', () => navigateQuestion(-1));
    document.getElementById('nextBtn')?.addEventListener('click', () => navigateQuestion(1));
    document.getElementById('submitBtn')?.addEventListener('click', submitExam);
}

function displayQuestion(index) {
    if (index < 0 || index >= EXAM_QUESTIONS.length) return;

    const question = EXAM_QUESTIONS[index];
    document.getElementById('currentQNum').textContent = index + 1;
    document.getElementById('questionText').textContent = question.question;
    document.getElementById('progressFill').style.width = `${((index + 1) / EXAM_QUESTIONS.length) * 100}%`;

    const optionsContainer = document.getElementById('optionsContainer');
    optionsContainer.innerHTML = '';

    const optionKeys = ['A', 'B', 'C', 'D'];
    optionKeys.forEach((key) => {
        const div = document.createElement('div');
        div.className = 'option-item';
        if (userAnswers[index] === key) {
            div.classList.add('selected');
        }
        div.textContent = `${key}. ${question.options[key]}`;
        div.addEventListener('click', () => selectOption(index, key));
        optionsContainer.appendChild(div);
    });

    currentQuestionIndex = index;
    updateButtons();
}

function selectOption(questionIndex, optionKey) {
    userAnswers[questionIndex] = optionKey;
    displayQuestion(questionIndex);
}

function navigateQuestion(direction) {
    const newIndex = currentQuestionIndex + direction;
    if (newIndex >= 0 && newIndex < EXAM_QUESTIONS.length) {
        displayQuestion(newIndex);
    }
}

function updateButtons() {
    document.getElementById('prevBtn').disabled = currentQuestionIndex === 0;
    document.getElementById('nextBtn').disabled = currentQuestionIndex === EXAM_QUESTIONS.length - 1;
}

function startTimer() {
    const timerDisplay = document.getElementById('timerDisplay');
    examStartTime = new Date();

    timer = setInterval(() => {
        timeLeft--;
        const minutes = Math.floor(timeLeft / 60);
        const seconds = timeLeft % 60;
        timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

        if (timeLeft <= 0) {
            clearInterval(timer);
            alert('Time is up! Your exam will be submitted automatically.');
            submitExam();
        }
    }, 1000);
}

// ==================== SUBMIT EXAM ====================
async function submitExam() {
    if (examSubmitted) return;
    
    const unanswered = userAnswers.filter(a => a === null).length;
    if (unanswered > 0) {
        if (!confirm(`You have ${unanswered} unanswered questions. Are you sure you want to submit?`)) {
            return;
        }
    }

    examSubmitted = true;
    clearInterval(timer);
    examEndTime = new Date();
    const timeTaken = Math.floor((examEndTime - examStartTime) / 1000);

    let correct = 0;
    EXAM_QUESTIONS.forEach((q, index) => {
        if (userAnswers[index] === q.correct) correct++;
    });

    const total = EXAM_QUESTIONS.length;
    const percentage = ((correct / total) * 100).toFixed(2);
    const passFail = percentage >= 50 ? 'Pass' : 'Fail';

    const resultData = {
        studentName: currentUser.name,
        username: currentUser.username,
        score: correct,
        totalQuestions: total,
        percentage: parseFloat(percentage),
        passFail: passFail,
        examDate: new Date().toLocaleDateString(),
        timeTaken: timeTaken,
        submittedAt: new Date().toISOString(),
        synced: false, // Mark as not synced
        deviceId: navigator.userAgent || 'unknown' // Track which device
    };

    localStorage.setItem('examResult', JSON.stringify(resultData));

    // ==================== SAVE RESULT (Online/Offline) ====================
    if (navigator.onLine) {
        try {
            await saveExamResult(resultData);
            resultData.synced = true;
            localStorage.setItem('examResult', JSON.stringify(resultData));
            alert('✅ Result Saved Successfully to Firebase!');
            window.location.href = 'result.html';
        } catch (error) {
            console.error('Error saving result:', error);
            saveOfflineResult(resultData);
            alert('⚠️ Could not save to Firebase. Result saved locally. Will sync when online.');
            window.location.href = 'result.html';
        }
    } else {
        // Offline mode - save locally
        saveOfflineResult(resultData);
        alert('📱 Offline Mode: Result saved locally. Will auto-sync when internet connects.');
        window.location.href = 'result.html';
    }
}

// ==================== OFFLINE RESULT FUNCTIONS ====================
function saveOfflineResult(resultData) {
    // Check if already exists
    const exists = offlineResults.some(r => 
        r.username === resultData.username && 
        r.submittedAt === resultData.submittedAt
    );
    
    if (!exists) {
        offlineResults.push(resultData);
        localStorage.setItem('offlineResults', JSON.stringify(offlineResults));
        console.log('✅ Result saved offline for:', resultData.studentName);
        
        // Also store in a global collection for admin to see
        saveToGlobalOfflineCollection(resultData);
    }
}

// ==================== GLOBAL OFFLINE COLLECTION ====================
// This stores all offline results from all students in one place
function saveToGlobalOfflineCollection(resultData) {
    let allOfflineResults = JSON.parse(localStorage.getItem('allOfflineResults')) || [];
    
    // Check if already exists
    const exists = allOfflineResults.some(r => 
        r.username === resultData.username && 
        r.submittedAt === resultData.submittedAt
    );
    
    if (!exists) {
        allOfflineResults.push(resultData);
        localStorage.setItem('allOfflineResults', JSON.stringify(allOfflineResults));
        console.log('📊 Added to global offline collection:', resultData.studentName);
    }
}

async function syncOfflineResults() {
    if (navigator.onLine) {
        // Get all offline results from global collection
        let allOfflineResults = JSON.parse(localStorage.getItem('allOfflineResults')) || [];
        
        if (allOfflineResults.length === 0) {
            console.log('✅ No offline results to sync');
            return true;
        }
        
        console.log(`🔄 Syncing ${allOfflineResults.length} offline results to Firebase...`);
        let syncedCount = 0;
        let failedResults = [];
        
        for (const result of allOfflineResults) {
            try {
                await saveExamResult(result);
                syncedCount++;
                console.log(`✅ Synced: ${result.studentName} (${result.username})`);
            } catch (error) {
                console.error(`❌ Sync failed for: ${result.studentName}`, error);
                failedResults.push(result);
            }
        }
        
        // Update storage
        if (failedResults.length === 0) {
            // All synced successfully
            localStorage.setItem('allOfflineResults', JSON.stringify([]));
            localStorage.setItem('offlineResults', JSON.stringify([]));
            console.log(`✅ All ${syncedCount} offline results synced to Firebase!`);
            return true;
        } else {
            // Keep failed results for retry
            localStorage.setItem('allOfflineResults', JSON.stringify(failedResults));
            console.log(`⚠️ ${failedResults.length} results failed to sync, will retry later`);
            return false;
        }
    }
    return false;
}

// ==================== FIREBASE FUNCTIONS ====================
async function saveExamResult(resultData) {
    try {
        const docRef = await addDoc(collection(db, 'exam-results'), {
            ...resultData,
            submittedAt: serverTimestamp()
        });
        console.log('Result saved with ID:', docRef.id);
        return docRef.id;
    } catch (error) {
        console.error('Firebase save error:', error);
        throw error;
    }
}

async function getAllResults() {
    try {
        const q = query(collection(db, 'exam-results'), orderBy('submittedAt', 'desc'));
        const querySnapshot = await getDocs(q);
        const results = [];
        querySnapshot.forEach((doc) => {
            results.push({ id: doc.id, ...doc.data() });
        });
        return results;
    } catch (error) {
        console.error('Error fetching results:', error);
        return [];
    }
}

// ==================== RESULT PAGE ====================
if (window.location.pathname.includes('result.html')) {
    const resultData = JSON.parse(localStorage.getItem('examResult'));
    if (!resultData) {
        window.location.href = '../index.html';
    }

    // Auto-sync if online
    if (navigator.onLine) {
        syncOfflineResults();
    }

    const resultContainer = document.getElementById('resultContent');
    const isSynced = resultData.synced || false;
    
    resultContainer.innerHTML = `
        <h2>📊 Your Exam Results</h2>
        <div class="result-item">
            <span class="label">Student Name:</span>
            <span class="value">${resultData.studentName}</span>
        </div>
        <div class="result-item">
            <span class="label">Username:</span>
            <span class="value">${resultData.username}</span>
        </div>
        <div class="result-item">
            <span class="label">Score:</span>
            <span class="value">${resultData.score} / ${resultData.totalQuestions}</span>
        </div>
        <div class="result-item">
            <span class="label">Percentage:</span>
            <span class="value">${resultData.percentage}%</span>
        </div>
        <div class="result-item">
            <span class="label">Status:</span>
            <span class="value ${resultData.passFail === 'Pass' ? 'pass' : 'fail'}">
                ${resultData.passFail === 'Pass' ? '✅ PASS' : '❌ FAIL'}
            </span>
        </div>
        <div class="result-item">
            <span class="label">Time Taken:</span>
            <span class="value">${Math.floor(resultData.timeTaken / 60)}m ${resultData.timeTaken % 60}s</span>
        </div>
        <div class="result-item">
            <span class="label">Date:</span>
            <span class="value">${resultData.examDate}</span>
        </div>
        <div class="result-item" style="background: ${isSynced ? '#d4edda' : '#fff3cd'};">
            <span class="label">Status:</span>
            <span class="value" style="font-size:1rem; color: ${isSynced ? '#155724' : '#856404'};">
                ${isSynced ? '✅ Saved to Firebase' : '📱 Saved Locally - Will sync when online'}
            </span>
        </div>
        <div id="syncStatus" style="margin-top:10px; padding:10px; border-radius:8px; display:none;"></div>
    `;

    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        localStorage.clear();
        window.location.href = '../index.html';
    });
}

// ==================== ADMIN DASHBOARD ====================
if (window.location.pathname.includes('dashboard.html')) {
    const adminLoggedIn = localStorage.getItem('adminLoggedIn');
    if (!adminLoggedIn) {
        const password = prompt('Enter admin password:');
        if (password === 'admin123') {
            localStorage.setItem('adminLoggedIn', 'true');
        } else {
            alert('Invalid admin password!');
            window.location.href = '../index.html';
        }
    }

    loadAdminResults();

    document.getElementById('refreshBtn')?.addEventListener('click', () => {
        // Sync offline results first
        syncOfflineResults().then(() => {
            loadAdminResults();
        });
    });
    
    document.getElementById('searchInput')?.addEventListener('input', filterResults);
    document.getElementById('sortSelect')?.addEventListener('change', sortResults);
    document.getElementById('adminLogoutBtn')?.addEventListener('click', () => {
        localStorage.removeItem('adminLoggedIn');
        window.location.href = '../index.html';
    });
}

let allResults = [];
let onlineResults = [];
let offlineResultsData = [];

async function loadAdminResults() {
    const tbody = document.getElementById('resultsBody');
    tbody.innerHTML = '<tr><td colspan="7">Loading results...</td></tr>';

    try {
        // Get online results from Firebase
        onlineResults = await getAllResults();
        
        // Get offline results from global collection
        offlineResultsData = JSON.parse(localStorage.getItem('allOfflineResults')) || [];
        
        // Combine both (remove duplicates)
        const allUsernames = new Set();
        allResults = [];
        
        // Add online results first
        onlineResults.forEach(r => {
            const key = r.username + r.submittedAt;
            allUsernames.add(key);
            allResults.push({ ...r, source: 'online' });
        });
        
        // Add offline results (if not already in online)
        offlineResultsData.forEach(r => {
            const key = r.username + r.submittedAt;
            if (!allUsernames.has(key)) {
                allResults.push({ ...r, source: 'offline' });
            }
        });
        
        displayResults(allResults);
        
        // Show count with status
        const countMsg = document.getElementById('resultCount');
        if (countMsg) {
            const onlineCount = onlineResults.length;
            const offlineCount = offlineResultsData.length;
            const pendingSync = offlineResultsData.length;
            
            countMsg.innerHTML = `
                📊 Total Results: <strong>${allResults.length}</strong> 
                (${onlineCount} online ${pendingSync > 0 ? `+ ${pendingSync} offline pending sync 🔄` : '✅ All synced'})
                ${!navigator.onLine ? ' ⚠️ Offline Mode' : ''}
            `;
            countMsg.style.background = navigator.onLine ? '#d4edda' : '#fff3cd';
            countMsg.style.padding = '10px';
            countMsg.style.borderRadius = '8px';
            countMsg.style.color = navigator.onLine ? '#155724' : '#856404';
        }
    } catch (error) {
        // If Firebase fails, show offline results only
        offlineResultsData = JSON.parse(localStorage.getItem('allOfflineResults')) || [];
        allResults = offlineResultsData.map(r => ({ ...r, source: 'offline' }));
        displayResults(allResults);
        
        const countMsg = document.getElementById('resultCount');
        if (countMsg) {
            countMsg.innerHTML = `⚠️ Offline Mode - Showing ${allResults.length} local results`;
            countMsg.style.background = '#fff3cd';
            countMsg.style.padding = '10px';
            countMsg.style.borderRadius = '8px';
            countMsg.style.color = '#856404';
        }
        console.error(error);
    }
}

function displayResults(results) {
    const tbody = document.getElementById('resultsBody');
    if (results.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7">No results found</td></tr>';
        return;
    }

    tbody.innerHTML = results.map(result => `
        <tr>
            <td>${result.studentName || 'N/A'} ${result.source === 'offline' ? '📱' : ''}</td>
            <td>${result.username || 'N/A'}</td>
            <td>${result.score || 0}/${result.totalQuestions || 25}</td>
            <td>${result.percentage || 0}%</td>
            <td>
                <span class="status-badge ${result.passFail === 'Pass' ? 'status-pass' : 'status-fail'}">
                    ${result.passFail || 'N/A'}
                </span>
            </td>
            <td>${result.examDate || 'N/A'}</td>
            <td>${result.timeTaken ? `${Math.floor(result.timeTaken / 60)}m ${result.timeTaken % 60}s` : 'N/A'}</td>
        </tr>
    `).join('');
}

function filterResults() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const filtered = allResults.filter(r => 
        (r.studentName?.toLowerCase().includes(searchTerm) || 
         r.username?.toLowerCase().includes(searchTerm))
    );
    displayResults(filtered);
}

function sortResults() {
    const sortType = document.getElementById('sortSelect').value;
    let sorted = [...allResults];

    switch(sortType) {
        case 'highest':
            sorted.sort((a, b) => (b.score || 0) - (a.score || 0));
            break;
        case 'lowest':
            sorted.sort((a, b) => (a.score || 0) - (b.score || 0));
            break;
        case 'latest':
            sorted.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
            break;
    }

    displayResults(sorted);
}

if (window.location.pathname === '/' || window.location.pathname.includes('index.html')) {
    const userData = JSON.parse(localStorage.getItem('examUser'));
    const examStarted = localStorage.getItem('examStarted');
    
    if (userData && examStarted === 'true') {
        window.location.href = 'student/test.html';
    }
}

// ==================== LISTEN FOR ONLINE/OFFLINE EVENTS ====================
window.addEventListener('online', async () => {
    console.log('🟢 Back online! Syncing results...');
    
    // Show notification
    const statusMsg = document.getElementById('connectionStatus');
    if (statusMsg) {
        statusMsg.textContent = '✅ Back Online! Syncing results...';
        statusMsg.style.background = '#d4edda';
        statusMsg.style.color = '#155724';
    }
    
    // Sync offline results
    const synced = await syncOfflineResults();
    
    if (synced) {
        alert('✅ All offline results have been synced to Firebase!');
    }
    
    // Reload admin dashboard if open
    if (window.location.pathname.includes('dashboard.html')) {
        loadAdminResults();
    }
    
    // Update status
    if (statusMsg) {
        statusMsg.textContent = '✅ Online - Connected to Firebase';
        statusMsg.style.background = '#d4edda';
        statusMsg.style.color = '#155724';
    }
});

window.addEventListener('offline', () => {
    console.log('🔴 Offline mode activated');
    
    const statusMsg = document.getElementById('connectionStatus');
    if (statusMsg) {
        statusMsg.textContent = '📱 Offline - Results will be saved locally';
        statusMsg.style.background = '#fff3cd';
        statusMsg.style.color = '#856404';
    }
});

// ==================== CHECK FOR PENDING SYNC ON PAGE LOAD ====================
// Check if there are pending offline results
const pendingResults = JSON.parse(localStorage.getItem('allOfflineResults')) || [];
if (pendingResults.length > 0 && navigator.onLine) {
    console.log(`🔄 Found ${pendingResults.length} pending results, syncing...`);
    syncOfflineResults();
}

export { saveExamResult, getAllResults, syncOfflineResults };

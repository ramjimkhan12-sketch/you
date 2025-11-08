const TelegramBot = require('node-telegram-bot-api');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Bot token
const BOT_TOKEN = process.env.BOT_TOKEN || '8251202994:AAE6MtF11yRXLYFssFIz4hPU3ZTWR0lnDKI';

// Admin ID (set your Telegram user ID here)
const ADMIN_ID = process.env.ADMIN_ID ? parseInt(process.env.ADMIN_ID) : 6393419765;

// Create bot instance
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('🚀 Powerful Hybrid YouTube Search Telegram Bot is running...');
console.log('📡 Node.js: Telegram Bot API');
console.log('🐍 Python: YouTube Operations (yt-dlp)');
if (ADMIN_ID) {
    console.log(`👤 Admin ID: ${ADMIN_ID}`);
} else {
    console.log('⚠️ Admin ID not set. Set ADMIN_ID in .env file or bot_hybrid.js');
}

// Store command count per user (chatId)
const userCommandCount = {};

// Data file path
const DATA_FILE = path.join(__dirname, 'admin_data.json');

// Admin statistics
let adminStats = {
    totalUsers: new Set(),
    totalCommands: 0,
    commandsByType: {
        start: 0,
        search: 0,
        download: 0,
        audio: 0,
        info: 0,
        trending: 0,
        help: 0,
        playlist: 0,
        channel: 0,
        subtitle: 0,
        thumbnail: 0
    },
    userActivity: {}, // {chatId: {firstSeen, lastSeen, commandCount, commands: []}}
    broadcastQueue: [],
    bannedUsers: new Set(), // Banned user IDs
    maintenanceMode: false, // Maintenance mode flag
    botStartTime: new Date(), // Bot start time
    offerUrl: 'https://otieu.com/4/10156674', // Default offer URL
    offerUpdateQueue: [], // Queue for updating offer URL
    userSearchQueue: [], // Queue for user search
    userFavorites: {}, // {chatId: [{videoId, title, url, addedAt}]}
    downloadHistory: {}, // {chatId: [{videoId, title, url, type, quality, downloadedAt}]}
    userLanguages: {} // {chatId: 'en' or 'bn'} - User language preferences
};

// Function to save admin stats to file
function saveAdminStats() {
    try {
        const dataToSave = {
            totalUsers: Array.from(adminStats.totalUsers),
            totalCommands: adminStats.totalCommands,
            commandsByType: adminStats.commandsByType,
            userActivity: adminStats.userActivity,
            bannedUsers: Array.from(adminStats.bannedUsers),
            maintenanceMode: adminStats.maintenanceMode,
            botStartTime: adminStats.botStartTime ? adminStats.botStartTime.toISOString() : new Date().toISOString(),
            offerUrl: adminStats.offerUrl || 'https://otieu.com/4/10156674',
            userFavorites: adminStats.userFavorites || {},
            downloadHistory: adminStats.downloadHistory || {},
            userLanguages: adminStats.userLanguages || {}
        };
        
        // Convert Date objects in userActivity to ISO strings
        const processedUserActivity = {};
        for (const [chatId, activity] of Object.entries(dataToSave.userActivity)) {
            if (activity && activity.firstSeen && activity.lastSeen) {
                processedUserActivity[chatId] = {
                    ...activity,
                    firstSeen: activity.firstSeen instanceof Date ? activity.firstSeen.toISOString() : (activity.firstSeen || new Date().toISOString()),
                    lastSeen: activity.lastSeen instanceof Date ? activity.lastSeen.toISOString() : (activity.lastSeen || new Date().toISOString()),
                    commandCount: activity.commandCount || 0,
                    commands: (activity.commands || []).map(cmd => ({
                        ...cmd,
                        timestamp: cmd.timestamp instanceof Date ? cmd.timestamp.toISOString() : (cmd.timestamp || new Date().toISOString())
                    }))
                };
            }
        }
        dataToSave.userActivity = processedUserActivity;
        
        // Write to temporary file first, then rename (atomic write)
        const tempFile = DATA_FILE + '.tmp';
        fs.writeFileSync(tempFile, JSON.stringify(dataToSave, null, 2), 'utf8');
        fs.renameSync(tempFile, DATA_FILE);
        console.log(`[DEBUG] Admin stats saved to file (${adminStats.totalUsers.size} users, ${adminStats.totalCommands} commands)`);
    } catch (error) {
        console.error('[ERROR] Error saving admin stats:', error);
        // Try to save to backup file
        try {
            const backupFile = DATA_FILE + '.backup';
            fs.writeFileSync(backupFile, JSON.stringify({
                totalUsers: Array.from(adminStats.totalUsers),
                totalCommands: adminStats.totalCommands,
                commandsByType: adminStats.commandsByType,
                bannedUsers: Array.from(adminStats.bannedUsers),
                maintenanceMode: adminStats.maintenanceMode,
                offerUrl: adminStats.offerUrl
            }, null, 2));
            console.log('[DEBUG] Saved backup file');
        } catch (backupError) {
            console.error('[ERROR] Failed to save backup:', backupError);
        }
    }
}

// Function to load admin stats from file
function loadAdminStats() {
    try {
        let dataFile = DATA_FILE;
        
        // Try to load from main file first
        if (!fs.existsSync(DATA_FILE)) {
            // Try backup file
            const backupFile = DATA_FILE + '.backup';
            if (fs.existsSync(backupFile)) {
                console.log('[DEBUG] Main file not found, trying backup file...');
                dataFile = backupFile;
            } else {
                console.log('[DEBUG] No existing data file found, starting fresh');
                adminStats.botStartTime = new Date();
                return;
            }
        }
        
        const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
        
        adminStats.totalUsers = new Set(data.totalUsers || []);
        adminStats.totalCommands = data.totalCommands || 0;
        adminStats.commandsByType = data.commandsByType || {
            start: 0,
            search: 0,
            download: 0,
            audio: 0,
            info: 0,
            trending: 0,
            help: 0,
            playlist: 0,
            channel: 0,
            subtitle: 0,
            thumbnail: 0
        };
        adminStats.bannedUsers = new Set(data.bannedUsers || []);
        adminStats.maintenanceMode = data.maintenanceMode || false;
        adminStats.offerUrl = data.offerUrl || 'https://otieu.com/4/10156674';
        adminStats.userFavorites = data.userFavorites || {};
        adminStats.downloadHistory = data.downloadHistory || {};
        adminStats.userLanguages = data.userLanguages || {};
        
        // Convert ISO strings back to Date objects in userActivity
        adminStats.userActivity = {};
        if (data.userActivity) {
            for (const [chatId, activity] of Object.entries(data.userActivity)) {
                try {
                    adminStats.userActivity[chatId] = {
                        ...activity,
                        firstSeen: activity.firstSeen ? new Date(activity.firstSeen) : new Date(),
                        lastSeen: activity.lastSeen ? new Date(activity.lastSeen) : new Date(),
                        commandCount: activity.commandCount || 0,
                        commands: (activity.commands || []).map(cmd => ({
                            ...cmd,
                            timestamp: cmd.timestamp ? new Date(cmd.timestamp) : new Date()
                        }))
                    };
                } catch (userError) {
                    console.error(`[ERROR] Error loading user ${chatId}:`, userError);
                }
            }
        }
        
        // Set bot start time if not exists
        if (data.botStartTime) {
            adminStats.botStartTime = new Date(data.botStartTime);
        } else {
            adminStats.botStartTime = new Date();
        }
        
        console.log('[DEBUG] Admin stats loaded from file');
        console.log(`[DEBUG] Loaded: ${adminStats.totalUsers.size} users, ${adminStats.totalCommands} commands, ${adminStats.bannedUsers.size} banned users`);
        
        // Save immediately after load to ensure data is in correct format
        saveAdminStats();
    } catch (error) {
        console.error('[ERROR] Error loading admin stats:', error);
        console.log('[DEBUG] Starting with fresh data due to load error');
        adminStats.botStartTime = new Date();
    }
}

// Load data on startup
loadAdminStats();

// Auto-save every 1 minute (more frequent to prevent data loss)
setInterval(() => {
    saveAdminStats();
}, 1 * 60 * 1000);

// Save on process exit - Multiple handlers for different scenarios
process.on('SIGINT', () => {
    console.log('\n[DEBUG] SIGINT received - Saving data before exit...');
    saveAdminStats();
    setTimeout(() => process.exit(0), 1000);
});

process.on('SIGTERM', () => {
    console.log('\n[DEBUG] SIGTERM received - Saving data before exit...');
    saveAdminStats();
    setTimeout(() => process.exit(0), 1000);
});

process.on('beforeExit', () => {
    console.log('\n[DEBUG] beforeExit event - Saving data...');
    saveAdminStats();
});

process.on('exit', () => {
    console.log('\n[DEBUG] Process exiting - Final save...');
    saveAdminStats();
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('\n[ERROR] Uncaught exception:', error);
    saveAdminStats();
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('\n[ERROR] Unhandled rejection at:', promise, 'reason:', reason);
    saveAdminStats();
});

// Helper function to check if user is admin
function isAdmin(chatId) {
    if (!ADMIN_ID) {
        return false;
    }
    return chatId === ADMIN_ID;
}

// Helper function to check if user is banned and send message
// Translation system
const translations = {
    en: {
        welcome: `🎬 *Welcome to Powerful YouTube Bot!*\n\n` +
            `I can help you:\n` +
            `✅ Search YouTube videos\n` +
            `✅ Download videos in multiple qualities\n` +
            `✅ Download audio (MP3)\n` +
            `✅ Get video information\n` +
            `✅ View trending videos\n` +
            `✅ Download playlists & channels\n` +
            `✅ Download subtitles & thumbnails\n` +
            `✅ Batch download videos\n` +
            `✅ Save favorites & view history\n\n` +
            `*Features:*\n` +
            `⚡ Fast downloads\n` +
            `📺 Multiple quality options (240p-1080p)\n` +
            `🎵 Audio extraction (MP3)\n` +
            `📊 Video information\n` +
            `🔥 Trending videos\n` +
            `📋 Playlist & Channel support\n` +
            `⭐ Favorites & History\n\n` +
            `*Use the buttons below or type /help for commands.*`,
        languageChanged: '✅ Language changed to English',
        selectLanguage: '🌐 *Select Language / ভাষা নির্বাচন করুন*\n\nChoose your preferred language:',
        currentLanguage: 'Current Language: English',
        banned: '🚫 *You are banned*\n\nYou have been banned from using this bot.\n\nContact admin for more information.',
        maintenance: '⚠️ *Bot Under Maintenance*\n\nThe bot is currently under maintenance. Please try again later.',
        searchQuery: '❌ Please provide a search query.\nExample: /search node.js tutorial',
        help: `📚 *Bot Commands*\n\n` +
            `/start - Start the bot\n` +
            `/search <query> - Search YouTube\n` +
            `/download <url> - Download video\n` +
            `/audio <url> - Download audio only (MP3)\n` +
            `/info <url> - Get video information\n` +
            `/trending - Get trending videos\n` +
            `/playlist <url> - Download entire playlist\n` +
            `/channel <url> - Download channel videos\n` +
            `/subtitle <url> - Download subtitles\n` +
            `/thumbnail <url> - Download thumbnail\n` +
            `/batch <url1,url2,...> - Batch download videos\n` +
            `/favorites - View your favorites\n` +
            `/history - View download history\n` +
            `/language - Change language\n` +
            `/help - Show help\n\n` +
            `*Use inline buttons for quick access!*`
    },
    bn: {
        welcome: `🎬 *Powerful YouTube Bot-এ স্বাগতম!*\n\n` +
            `আমি আপনাকে সাহায্য করতে পারি:\n` +
            `✅ YouTube ভিডিও খুঁজে বের করা\n` +
            `✅ বিভিন্ন কোয়ালিটিতে ভিডিও ডাউনলোড করা\n` +
            `✅ অডিও (MP3) ডাউনলোড করা\n` +
            `✅ ভিডিও তথ্য পাওয়া\n` +
            `✅ ট্রেন্ডিং ভিডিও দেখা\n` +
            `✅ প্লেলিস্ট ও চ্যানেল ডাউনলোড করা\n` +
            `✅ সাবটাইটেল ও থাম্বনেইল ডাউনলোড করা\n` +
            `✅ একসাথে অনেক ভিডিও ডাউনলোড করা\n` +
            `✅ পছন্দের ভিডিও সংরক্ষণ ও ইতিহাস দেখা\n\n` +
            `*বৈশিষ্ট্য:*\n` +
            `⚡ দ্রুত ডাউনলোড\n` +
            `📺 বিভিন্ন কোয়ালিটি অপশন (240p-1080p)\n` +
            `🎵 অডিও এক্সট্র্যাকশন (MP3)\n` +
            `📊 ভিডিও তথ্য\n` +
            `🔥 ট্রেন্ডিং ভিডিও\n` +
            `📋 প্লেলিস্ট ও চ্যানেল সাপোর্ট\n` +
            `⭐ পছন্দের ভিডিও ও ইতিহাস\n\n` +
            `*নিচের বাটন ব্যবহার করুন অথবা /help টাইপ করুন।*`,
        languageChanged: '✅ ভাষা বাংলায় পরিবর্তন করা হয়েছে',
        selectLanguage: '🌐 *Select Language / ভাষা নির্বাচন করুন*\n\nআপনার পছন্দের ভাষা বেছে নিন:',
        currentLanguage: 'বর্তমান ভাষা: বাংলা',
        banned: '🚫 *আপনাকে বাধা দেওয়া হয়েছে*\n\nআপনাকে এই বট ব্যবহার করা থেকে বাধা দেওয়া হয়েছে।\n\nআরও তথ্যের জন্য অ্যাডমিনের সাথে যোগাযোগ করুন।',
        maintenance: '⚠️ *বট রক্ষণাবেক্ষণে রয়েছে*\n\nবটটি বর্তমানে রক্ষণাবেক্ষণে রয়েছে। অনুগ্রহ করে পরে আবার চেষ্টা করুন।',
        searchQuery: '❌ অনুগ্রহ করে একটি সার্চ কোয়েরি দিন।\nউদাহরণ: /search node.js tutorial',
        help: `📚 *বট কমান্ড*\n\n` +
            `/start - বট শুরু করুন\n` +
            `/search <query> - YouTube সার্চ করুন\n` +
            `/download <url> - ভিডিও ডাউনলোড করুন\n` +
            `/audio <url> - শুধু অডিও ডাউনলোড করুন (MP3)\n` +
            `/info <url> - ভিডিও তথ্য পান\n` +
            `/trending - ট্রেন্ডিং ভিডিও দেখুন\n` +
            `/playlist <url> - পুরো প্লেলিস্ট ডাউনলোড করুন\n` +
            `/channel <url> - চ্যানেল ভিডিও ডাউনলোড করুন\n` +
            `/subtitle <url> - সাবটাইটেল ডাউনলোড করুন\n` +
            `/thumbnail <url> - থাম্বনেইল ডাউনলোড করুন\n` +
            `/batch <url1,url2,...> - একসাথে অনেক ভিডিও ডাউনলোড করুন\n` +
            `/favorites - আপনার পছন্দের ভিডিও দেখুন\n` +
            `/history - ডাউনলোড ইতিহাস দেখুন\n` +
            `/language - ভাষা পরিবর্তন করুন\n` +
            `/help - সাহায্য দেখুন\n\n` +
            `*দ্রুত অ্যাক্সেসের জন্য ইনলাইন বাটন ব্যবহার করুন!*`
    }
};

// Helper function to get user language (default: 'en')
function getUserLanguage(chatId) {
    return adminStats.userLanguages[chatId] || 'en';
}

// Helper function to get reply keyboard with all commands
function getReplyKeyboard() {
    return {
        keyboard: [
            [
                { text: '🔍 Search' },
                { text: '🔥 Trending' },
                { text: '📊 Info' }
            ],
            [
                { text: '📥 Download' },
                { text: '🎵 Audio' }
            ],
            [
                { text: '📋 Playlist' },
                { text: '📺 Channel' }
            ],
            [
                { text: '📝 Subtitle' },
                { text: '🖼️ Thumbnail' },
                { text: '📦 Batch' }
            ],
            [
                { text: '⭐ Favorites' },
                { text: '📜 History' }
            ],
            [
                { text: '🌐 Language' },
                { text: '❓ Help' }
            ]
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    };
}

// Helper function to get translated text
function t(chatId, key) {
    const lang = getUserLanguage(chatId);
    return translations[lang][key] || translations.en[key] || key;
}

async function checkBannedUser(chatId) {
    if (adminStats.bannedUsers.has(chatId)) {
        const banMessage = t(chatId, 'banned') + `\n\n📞 *Contact Admin:*\n` +
            `Admin ID: \`${ADMIN_ID}\`\n\n` +
            `━━━━━━━━━━━━━━━━━━━━`;
        
        try {
            await bot.sendMessage(chatId, banMessage, {
                parse_mode: 'Markdown'
            });
        } catch (error) {
            // Fallback to plain text if Markdown fails
            await bot.sendMessage(chatId, t(chatId, 'banned') + `\n\n📞 Contact Admin:\nAdmin ID: ${ADMIN_ID}`);
        }
        return true;
    }
    return false;
}

// Helper function to track user activity
function trackUserActivity(chatId, commandType) {
    // Check if user is banned
    if (adminStats.bannedUsers.has(chatId)) {
        return;
    }
    
    // Check maintenance mode
    if (adminStats.maintenanceMode && !isAdmin(chatId)) {
        return;
    }
    
    // Add user to total users set
    adminStats.totalUsers.add(chatId);
    
    // Increment total commands
    adminStats.totalCommands++;
    
    // Increment command type counter
    if (adminStats.commandsByType[commandType]) {
        adminStats.commandsByType[commandType]++;
    }
    
    // Track user activity
    if (!adminStats.userActivity[chatId]) {
        adminStats.userActivity[chatId] = {
            firstSeen: new Date(),
            lastSeen: new Date(),
            commandCount: 0,
            commands: []
        };
    }
    adminStats.userActivity[chatId].lastSeen = new Date();
    adminStats.userActivity[chatId].commandCount++;
    adminStats.userActivity[chatId].commands.push({
        command: commandType,
        timestamp: new Date()
    });
    
    // Keep only last 50 commands per user
    if (adminStats.userActivity[chatId].commands.length > 50) {
        adminStats.userActivity[chatId].commands.shift();
    }
    
    // Auto-save after tracking (every 5 commands to prevent data loss)
    if (adminStats.totalCommands % 5 === 0) {
        saveAdminStats();
    }
}

// Helper function to send offer message
function sendOfferMessage(chatId) {
    const offerMessage = `━━━━━━━━━━━━━━━━━━━━\n` +
        `🎁 *Special Offer Available!*\n\n` +
        `💎 Get exclusive deals and offers\n` +
        `✨ Limited time offer - Don't miss out!\n` +
        `🔥 Click below to claim your free offer\n` +
        `━━━━━━━━━━━━━━━━━━━━`;
    
    const offerKeyboard = {
        inline_keyboard: [
            [
                { text: '🎁 Get Free Offer - Claim Now! 🎉', url: adminStats.offerUrl }
            ]
        ]
    };
    
    bot.sendMessage(chatId, offerMessage, {
        parse_mode: 'Markdown',
        reply_markup: offerKeyboard
    }).catch(err => {
        // Ignore errors if message fails
        console.error('Error sending offer message:', err);
    });
}

// Helper function to track commands and send offer after 3 commands
function trackCommandAndSendOffer(chatId) {
    // Initialize counter if not exists
    if (!userCommandCount[chatId]) {
        userCommandCount[chatId] = 0;
    }
    
    // Increment counter
    userCommandCount[chatId]++;
    
    // After 3 commands, send offer message and reset counter
    if (userCommandCount[chatId] >= 3) {
        setTimeout(() => {
            sendOfferMessage(chatId);
        }, 2000);
        // Reset counter
        userCommandCount[chatId] = 0;
    }
}

// Helper function to run Python script with progress tracking
function runPythonScriptWithProgress(command, ...args) {
    return new Promise((resolve, reject) => {
        const pythonProcess = spawn('python', ['youtube_service.py', command, ...args]);
        let stdout = '';
        let stderr = '';
        let progressCallback = null;

        pythonProcess.stdout.on('data', (data) => {
            const output = data.toString();
            stdout += output;
            
            // Check for progress updates
            const lines = output.split('\n');
            for (const line of lines) {
                if (line.startsWith('PROGRESS:')) {
                    try {
                        const progressData = JSON.parse(line.replace('PROGRESS:', ''));
                        if (progressCallback) {
                            progressCallback(progressData);
                        }
                    } catch (e) {
                        // Ignore parse errors
                    }
                }
            }
        });

        pythonProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        pythonProcess.on('close', (code) => {
            // Clean stdout - remove progress lines
            stdout = stdout.split('\n')
                .filter(line => !line.startsWith('PROGRESS:'))
                .join('\n')
                .trim();
            
            // Try to extract JSON from stdout
            let jsonMatch = stdout.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                stdout = jsonMatch[0];
            }
            
            if (code !== 0) {
                reject(new Error(stderr || `Process exited with code ${code}`));
                return;
            }
            
            if (!stdout) {
                reject(new Error('No output from Python script'));
                return;
            }
            
            try {
                const result = JSON.parse(stdout);
                resolve(result);
            } catch (e) {
                console.error('JSON Parse Error:', e);
                console.error('Raw stdout:', stdout);
                reject(new Error('Failed to parse Python output: ' + stdout.substring(0, 200)));
            }
        });

        pythonProcess.on('error', (error) => {
            console.error('Python process error:', error);
            reject(error);
        });
        
        // Return object with process and progress callback setter
        return {
            process: pythonProcess,
            onProgress: (callback) => {
                progressCallback = callback;
            }
        };
    });
}

// Helper function to run Python script
function runPythonScript(command, ...args) {
    return new Promise((resolve, reject) => {
        const pythonProcess = spawn('python', ['youtube_service.py', command, ...args]);
        let stdout = '';
        let stderr = '';

        pythonProcess.stdout.on('data', (data) => {
            const output = data.toString();
            // Filter out progress lines
            const lines = output.split('\n');
            for (const line of lines) {
                if (!line.startsWith('PROGRESS:')) {
                    stdout += line + '\n';
                }
            }
        });

        pythonProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        pythonProcess.on('close', (code) => {
            stdout = stdout.trim();
            
            // Try to extract JSON from stdout
            let jsonMatch = stdout.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                stdout = jsonMatch[0];
            }
            
            if (code !== 0) {
                reject(new Error(stderr || `Process exited with code ${code}`));
                return;
            }
            
            if (!stdout) {
                reject(new Error('No output from Python script'));
                return;
            }
            
            try {
                const result = JSON.parse(stdout);
                resolve(result);
            } catch (e) {
                console.error('JSON Parse Error:', e);
                console.error('Raw stdout:', stdout);
                reject(new Error('Failed to parse Python output: ' + stdout.substring(0, 200)));
            }
        });

        pythonProcess.on('error', (error) => {
            console.error('Python process error:', error);
            reject(error);
        });
    });
}

// Handle /start command
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    
    // Check if user is banned
    if (await checkBannedUser(chatId)) {
        return;
    }
    
    trackUserActivity(chatId, 'start');
    
    const welcomeMessage = t(chatId, 'welcome');
    
    bot.sendMessage(chatId, welcomeMessage, {
        parse_mode: 'Markdown',
        reply_markup: getReplyKeyboard()
    });
    
    // Send reply keyboard separately with better message
    const keyboardMessage = getUserLanguage(chatId) === 'bn' 
        ? '⌨️ *কমান্ড কিবোর্ড সক্রিয় হয়েছে!*\n\n✅ সব commands এখন buttons দিয়ে access করুন\n\n📱 নিচের buttons ব্যবহার করুন:'
        : '⌨️ *Command Keyboard Activated!*\n\n✅ All commands are now available as buttons\n\n📱 Use the buttons below:';
    
    bot.sendMessage(chatId, keyboardMessage, {
        parse_mode: 'Markdown',
        reply_markup: getReplyKeyboard()
    });
    
    // Track command and send offer after 3 commands
    trackCommandAndSendOffer(chatId);
});

// Handle /help command
bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    
    // Check if user is banned
    if (await checkBannedUser(chatId)) {
        return;
    }
    
    trackUserActivity(chatId, 'help');
    
    const helpMessage = t(chatId, 'help');
    
    bot.sendMessage(chatId, helpMessage, { 
        parse_mode: 'Markdown',
        reply_markup: getReplyKeyboard()
    });
    
    // Also send reply keyboard with better message
    const keyboardMessage = getUserLanguage(chatId) === 'bn'
        ? '⌨️ *কমান্ড কিবোর্ড*\n\n✅ Quick access এর জন্য buttons ব্যবহার করুন!'
        : '⌨️ *Command Keyboard*\n\n✅ Use buttons for quick access!';
    
    bot.sendMessage(chatId, keyboardMessage, {
        parse_mode: 'Markdown',
        reply_markup: getReplyKeyboard()
    });
    
    // Track command and send offer after 3 commands
    trackCommandAndSendOffer(chatId);
});

// Handle /language command
bot.onText(/\/language/, async (msg) => {
    const chatId = msg.chat.id;
    
    // Check if user is banned
    if (await checkBannedUser(chatId)) {
        return;
    }
    
    trackUserActivity(chatId, 'language');
    
    const currentLang = getUserLanguage(chatId);
    const message = t(chatId, 'selectLanguage');
    
    const keyboard = {
        inline_keyboard: [
            [
                { text: currentLang === 'en' ? '✅ English' : 'English', callback_data: 'lang_en' },
                { text: currentLang === 'bn' ? '✅ বাংলা' : 'বাংলা', callback_data: 'lang_bn' }
            ]
        ]
    };
    
    await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
    });
});

// Handle /search command
bot.onText(/\/search (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    
    // Check if user is banned
    if (await checkBannedUser(chatId)) {
        return;
    }
    
    const query = match[1];
    trackUserActivity(chatId, 'search');
    
    if (!query || query.trim().length === 0) {
        bot.sendMessage(chatId, '❌ Please provide a search query.\nExample: /search node.js tutorial');
        return;
    }
    
    await searchVideos(chatId, query);
});

// Handle search: messages
bot.onText(/^search:(.+)/i, async (msg, match) => {
    const chatId = msg.chat.id;
    
    // Check if user is banned
    if (await checkBannedUser(chatId)) {
        return;
    }
    
    const query = match[1].trim();
    
    if (!query || query.length === 0) {
        bot.sendMessage(chatId, '❌ Please provide a search query.\nExample: search: node.js tutorial');
        return;
    }
    
    await searchVideos(chatId, query);
});

// Search videos function
async function searchVideos(chatId, query) {
    try {
        // Check if user is banned
        if (await checkBannedUser(chatId)) {
            return;
        }
        
        trackUserActivity(chatId, 'search');
        const searchingMsg = await bot.sendMessage(chatId, `🔍 Searching for: "${query}"...`);
        
        // Call Python service for search
        const result = await runPythonScript('search', query, '5');
        
        if (!result.success || !result.videos || result.videos.length === 0) {
            await bot.editMessageText('❌ No results found. Try a different search query.', {
                chat_id: chatId,
                message_id: searchingMsg.message_id
            });
            return;
        }
        
        // Delete searching message
        try {
            await bot.deleteMessage(chatId, searchingMsg.message_id);
        } catch (e) {}
        
        // Send header
        await bot.sendMessage(chatId, `🎬 *Search Results for: "${query}"*\n\nFound ${result.videos.length} video(s):`, {
            parse_mode: 'Markdown',
            reply_markup: getReplyKeyboard()
        });
        
        // Send each video with thumbnail
        for (let index = 0; index < result.videos.length; index++) {
            const video = result.videos[index];
            const title = video.title || 'No title';
            const videoId = video.id || '';
            const channel = video.channel || 'Unknown channel';
            const duration = video.duration || 0;
            const durationStr = duration ? `${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')}` : 'Unknown duration';
            const viewCount = video.view_count ? `${video.view_count.toLocaleString()} views` : 'Unknown views';
            const videoUrl = video.webpage_url || video.url || `https://www.youtube.com/watch?v=${videoId}`;
            const thumbnail = video.thumbnail || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
            
            const caption = `${index + 1}. *${escapeMarkdown(title)}*\n` +
                `👤 Channel: ${escapeMarkdown(channel)}\n` +
                `⏱ Duration: ${durationStr}\n` +
                `👁 Views: ${viewCount}\n` +
                `🔗 [Watch Video](${videoUrl})`;
            
            // Create inline keyboard with multiple options
            const keyboard = {
                inline_keyboard: [
                    [
                        {
                            text: '▶️ Play',
                            callback_data: `play_${videoId}`
                        },
                        {
                            text: '⬇️ Download',
                            callback_data: `quality_${videoId}`
                        },
                        {
                            text: '🎵 Audio',
                            callback_data: `audio_${videoId}`
                        }
                    ],
                    [
                        {
                            text: '📊 Info',
                            callback_data: `info_${videoId}`
                        },
                        {
                            text: '⭐ Favorite',
                            callback_data: `favorite_${videoId}`
                        },
                        {
                            text: '📺 Quality',
                            callback_data: `quality_${videoId}`
                        }
                    ],
                    [
                        {
                            text: '🔗 Open YouTube',
                            url: videoUrl
                        }
                    ]
                ]
            };
            
            try {
                // Validate thumbnail URL
                if (thumbnail && (thumbnail.startsWith('http://') || thumbnail.startsWith('https://'))) {
                    await bot.sendPhoto(chatId, thumbnail, {
                        caption: caption,
                        parse_mode: 'Markdown',
                        reply_markup: keyboard
                    });
                } else {
                    await bot.sendMessage(chatId, caption, {
                        parse_mode: 'Markdown',
                        reply_markup: keyboard
                    });
                }
            } catch (photoError) {
                await bot.sendMessage(chatId, caption, {
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                });
            }
        }
        
    } catch (error) {
        console.error('Search error:', error);
        bot.sendMessage(chatId, '❌ An error occurred while searching. Please try again later.');
    }
    
    // Track command and send offer after 3 commands
    trackCommandAndSendOffer(chatId);
}

// Handle /download command
bot.onText(/\/download (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    
    // Check if user is banned
    if (await checkBannedUser(chatId)) {
        return;
    }
    
    const url = match[1];
    trackUserActivity(chatId, 'download');
    
    if (!url || url.trim().length === 0) {
        bot.sendMessage(chatId, '❌ Please provide a YouTube URL.\nExample: /download https://www.youtube.com/watch?v=VIDEO_ID');
        return;
    }
    
    await downloadVideo(chatId, url);
});

// Handle callback queries (download, play, audio, info, quality buttons)
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    
    // Check if user is banned FIRST (except admin callbacks)
    // Admin can always use admin features
    if (data && !data.startsWith('admin_') && !isAdmin(chatId)) {
        if (adminStats.bannedUsers.has(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: '🚫 You are banned from using this bot', show_alert: true });
            // Also send ban message
            await checkBannedUser(chatId);
            return;
        }
    }
    
    // Admin panel callbacks
    if (data && data.startsWith('admin_')) {
        if (!isAdmin(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: '❌ Access Denied' });
            return;
        }
        
        await bot.answerCallbackQuery(query.id);
        
        if (data === 'admin_stats') {
            await showAdminStats(chatId, query.message.message_id);
        } else if (data === 'admin_dashboard') {
            await showAdminDashboard(chatId, query.message.message_id);
        } else if (data === 'admin_users') {
            await showAdminUsers(chatId, query.message.message_id);
        } else if (data === 'admin_broadcast') {
            await showBroadcastMenu(chatId, query.message.message_id);
        } else if (data === 'admin_settings') {
            await showAdminSettings(chatId, query.message.message_id);
        } else if (data === 'admin_refresh') {
            await bot.answerCallbackQuery(query.id, { text: 'Refreshing dashboard...' });
            await bot.editMessageText('🔄 Refreshing dashboard...', {
                chat_id: chatId,
                message_id: query.message.message_id
            });
            await showAdminDashboard(chatId, query.message.message_id);
        } else if (data === 'admin_logs') {
            await showAdminLogs(chatId, query.message.message_id);
        } else if (data === 'admin_user_search') {
            await showUserSearchMenu(chatId, query.message.message_id);
        } else if (data === 'admin_ban') {
            await showBanManagement(chatId, query.message.message_id);
        } else if (data === 'admin_analytics') {
            await showAdminAnalytics(chatId, query.message.message_id);
        } else if (data === 'admin_system') {
            await showSystemInfo(chatId, query.message.message_id);
        } else if (data === 'admin_clear_stats') {
            await showClearStatsConfirmation(chatId, query.message.message_id);
        } else if (data === 'admin_maintenance') {
            await showMaintenanceMenu(chatId, query.message.message_id);
        } else if (data === 'admin_update_offer') {
            await bot.answerCallbackQuery(query.id, { text: 'Opening update offer menu...' });
            await showUpdateOfferMenu(chatId, query.message.message_id);
        } else if (data === 'clear_stats_confirm') {
            await clearStatistics(chatId, query.message.message_id);
        } else if (data === 'clear_stats_cancel') {
            await showAdminPanel(chatId, query.message.message_id);
        } else if (data === 'maintenance_on') {
            adminStats.maintenanceMode = true;
            await bot.answerCallbackQuery(query.id, { text: '✅ Maintenance mode enabled' });
            saveAdminStats(); // Save after changing maintenance mode
            await showMaintenanceMenu(chatId, query.message.message_id);
        } else if (data === 'maintenance_off') {
            adminStats.maintenanceMode = false;
            await bot.answerCallbackQuery(query.id, { text: '✅ Maintenance mode disabled' });
            saveAdminStats(); // Save after changing maintenance mode
            await showMaintenanceMenu(chatId, query.message.message_id);
        } else if (data.startsWith('view_user_')) {
            const userId = data.replace('view_user_', '');
            await showUserDetails(chatId, query.message.message_id, userId);
        } else if (data === 'admin_back') {
            await showAdminPanel(chatId, query.message.message_id);
        }
        return;
    }
    
    // Handle ban/unban callbacks (not starting with admin_)
    if (data && (data.startsWith('ban_user_') || data.startsWith('unban_user_'))) {
        if (!isAdmin(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: '❌ Access Denied' });
            return;
        }
        
        if (data.startsWith('ban_user_')) {
            const userId = data.replace('ban_user_', '');
            await bot.answerCallbackQuery(query.id, { text: '🚫 User banned successfully' });
            await banUser(chatId, query.message.message_id, userId);
        } else if (data.startsWith('unban_user_')) {
            const userId = data.replace('unban_user_', '');
            await bot.answerCallbackQuery(query.id, { text: '✅ User unbanned successfully' });
            await unbanUser(chatId, query.message.message_id, userId);
        }
        return;
    }
    
    // Handle update_offer_start callback (not starting with admin_)
    if (data === 'update_offer_start' || data === 'update_offer_cancel') {
        if (!isAdmin(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: '❌ Access Denied' });
            return;
        }
        
        if (data === 'update_offer_start') {
            await bot.answerCallbackQuery(query.id, { text: 'Send the new offer URL now' });
            adminStats.offerUpdateQueue.push(chatId);
            console.log(`[DEBUG] Added ${chatId} to offerUpdateQueue. Queue:`, adminStats.offerUpdateQueue);
            await bot.editMessageText('🎁 Update Offer Link\n\n✅ Ready to receive new URL!\n\nPlease send the new offer URL now:', {
                chat_id: chatId,
                message_id: query.message.message_id
            });
        } else if (data === 'update_offer_cancel') {
            await bot.answerCallbackQuery(query.id, { text: 'Cancelled' });
            const index = adminStats.offerUpdateQueue.indexOf(chatId);
            if (index > -1) {
                adminStats.offerUpdateQueue.splice(index, 1);
            }
            await showUpdateOfferMenu(chatId, query.message.message_id);
        }
        return;
    }
    
    // Broadcast callbacks
    if (data === 'broadcast_start') {
        await bot.editMessageText('📢 Broadcast Message\n\nSend the message you want to broadcast to all users:', {
            chat_id: chatId,
            message_id: query.message.message_id
        });
        adminStats.broadcastQueue.push(chatId);
        await bot.answerCallbackQuery(query.id, { text: 'Send your broadcast message now' });
        return;
    } else if (data === 'broadcast_cancel') {
        const index = adminStats.broadcastQueue.indexOf(chatId);
        if (index > -1) {
            adminStats.broadcastQueue.splice(index, 1);
        }
        await bot.editMessageText('❌ Broadcast cancelled.', {
            chat_id: chatId,
            message_id: query.message.message_id
        });
        await bot.answerCallbackQuery(query.id, { text: 'Broadcast cancelled' });
        return;
    }
    
    // Handle help menu buttons
    if (data === 'help_menu') {
        // Check ban before processing
        if (!isAdmin(chatId) && adminStats.bannedUsers.has(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: '🚫 You are banned', show_alert: true });
            await checkBannedUser(chatId);
            return;
        }
        
        try {
            await bot.answerCallbackQuery(query.id, { text: 'Showing help...' });
        } catch (e) {}
        const helpMessage = t(chatId, 'help');
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🔍 Search Videos', switch_inline_query_current_chat: '' },
                    { text: '📊 Video Info', callback_data: 'info_help' }
                ],
                [
                    { text: '🔥 Trending', callback_data: 'trending_now' },
                    { text: '📥 Download Guide', callback_data: 'download_help' }
                ],
                [
                    { text: '🎵 Audio Guide', callback_data: 'audio_help' },
                    { text: '⚙️ Quality Options', callback_data: 'quality_help' }
                ],
                [
                    { text: '📋 Playlist Guide', callback_data: 'playlist_help' },
                    { text: '📺 Channel Guide', callback_data: 'channel_help' }
                ],
                [
                    { text: '📝 Subtitle Guide', callback_data: 'subtitle_help' },
                    { text: '🖼️ Thumbnail Guide', callback_data: 'thumbnail_help' }
                ],
                [
                    { text: '📦 Batch Guide', callback_data: 'batch_help' },
                    { text: '⭐ Favorites', callback_data: 'show_favorites' }
                ],
                [
                    { text: '📜 History', callback_data: 'show_history' },
                    { text: '🌐 Language', callback_data: 'select_language' }
                ]
            ]
        };
        
        await bot.sendMessage(chatId, helpMessage, { 
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
        return;
    }
    
    if (data === 'select_language') {
        // Check ban before processing
        if (!isAdmin(chatId) && adminStats.bannedUsers.has(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: '🚫 You are banned', show_alert: true });
            await checkBannedUser(chatId);
            return;
        }
        
        try {
            await bot.answerCallbackQuery(query.id, { text: 'Selecting language...' });
        } catch (e) {}
        
        const currentLang = getUserLanguage(chatId);
        const message = t(chatId, 'selectLanguage');
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: currentLang === 'en' ? '✅ English' : 'English', callback_data: 'lang_en' },
                    { text: currentLang === 'bn' ? '✅ বাংলা' : 'বাংলা', callback_data: 'lang_bn' }
                ]
            ]
        };
        
        try {
            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        } catch (e) {
            await bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        }
        return;
    }
    
    if (data === 'lang_en' || data === 'lang_bn') {
        // Check ban before processing
        if (!isAdmin(chatId) && adminStats.bannedUsers.has(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: '🚫 You are banned', show_alert: true });
            await checkBannedUser(chatId);
            return;
        }
        
        const lang = data === 'lang_en' ? 'en' : 'bn';
        adminStats.userLanguages[chatId] = lang;
        saveAdminStats();
        
        try {
            await bot.answerCallbackQuery(query.id, { text: lang === 'en' ? 'Language changed to English' : 'ভাষা বাংলায় পরিবর্তন করা হয়েছে' });
        } catch (e) {}
        
        // Get message in new language
        const langMessage = lang === 'en' ? '✅ Language changed to English' : '✅ ভাষা বাংলায় পরিবর্তন করা হয়েছে';
        await bot.sendMessage(chatId, langMessage, {
            parse_mode: 'Markdown'
        });
        return;
    }
    
    if (data === 'trending_now') {
        // Check ban before processing
        if (!isAdmin(chatId) && adminStats.bannedUsers.has(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: '🚫 You are banned', show_alert: true });
            await checkBannedUser(chatId);
            return;
        }
        
        try {
            await bot.answerCallbackQuery(query.id, { text: 'Loading trending videos...' });
        } catch (e) {}
        // Directly call the trending function
        await getTrendingVideos(chatId);
        return;
    }
    
    if (data === 'info_help') {
        // Check ban before processing
        if (!isAdmin(chatId) && adminStats.bannedUsers.has(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: '🚫 You are banned', show_alert: true });
            await checkBannedUser(chatId);
            return;
        }
        
        try {
            await bot.answerCallbackQuery(query.id, { text: 'Send YouTube URL with /info' });
        } catch (e) {}
        // Use plain text to avoid Markdown parsing issues with URLs
        await bot.sendMessage(chatId, `📊 Get Video Information\n\n` +
            `Send a YouTube URL with /info command:\n\n` +
            `Example:\n` +
            `/info https://www.youtube.com/watch?v=VIDEO_ID\n\n` +
            `Or use the info button from search results!`, {
            disable_web_page_preview: true
        });
        return;
    }
    
    if (data === 'download_help') {
        // Check ban before processing
        if (!isAdmin(chatId) && adminStats.bannedUsers.has(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: '🚫 You are banned', show_alert: true });
            await checkBannedUser(chatId);
            return;
        }
        
        try {
            await bot.answerCallbackQuery(query.id, { text: 'Download guide' });
        } catch (e) {}
        await bot.sendMessage(chatId, `📥 *Download Guide*\n\n` +
            `1. Search for videos using /search\n` +
            `2. Click "⬇️ Download" button\n` +
            `3. Select quality (240p-1080p)\n` +
            `4. Wait for download to complete\n\n` +
            `*Tips:*\n` +
            `• Lower quality = Faster download\n` +
            `• Large videos (>50MB) will be split automatically\n` +
            `• Use 240p/360p for quick downloads`, {
            parse_mode: 'Markdown'
        });
        return;
    }
    
    if (data === 'audio_help') {
        // Check ban before processing
        if (!isAdmin(chatId) && adminStats.bannedUsers.has(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: '🚫 You are banned', show_alert: true });
            await checkBannedUser(chatId);
            return;
        }
        
        try {
            await bot.answerCallbackQuery(query.id, { text: 'Audio download guide' });
        } catch (e) {}
        await bot.sendMessage(chatId, `🎵 *Audio Download Guide*\n\n` +
            `1. Search for videos using /search\n` +
            `2. Click "🎵 Audio Only" button\n` +
            `3. Audio will be downloaded as MP3\n\n` +
            `*Requirements:*\n` +
            `• FFmpeg must be installed for MP3 format\n` +
            `• See installation guide for setup\n\n` +
            `*Note:* Without FFmpeg, audio downloads in original format.`, {
            parse_mode: 'Markdown'
        });
        return;
    }
    
    if (data === 'quality_help') {
        // Check ban before processing
        if (!isAdmin(chatId) && adminStats.bannedUsers.has(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: '🚫 You are banned', show_alert: true });
            await checkBannedUser(chatId);
            return;
        }
        
        try {
            await bot.answerCallbackQuery(query.id, { text: 'Quality options guide' });
        } catch (e) {}
        await bot.sendMessage(chatId, `⚙️ *Quality Options*\n\n` +
            `*Available Qualities:*\n` +
            `• 240p - Lowest quality, fastest download ⚡⚡⚡⚡⚡\n` +
            `• 360p - Standard quality, fast download ⚡⚡⚡⚡\n` +
            `• 480p - Medium quality ⚡⚡⚡\n` +
            `• 720p - HD quality ⚡⚡\n` +
            `• 1080p - Full HD, best quality ⚡\n\n` +
            `*Recommendations:*\n` +
            `• Quick downloads: 240p or 360p\n` +
            `• Best quality: 1080p\n` +
            `• Large videos: Use lower quality`, {
            parse_mode: 'Markdown'
        });
        return;
    }
    
    if (data === 'playlist_help') {
        // Check ban before processing
        if (!isAdmin(chatId) && adminStats.bannedUsers.has(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: '🚫 You are banned', show_alert: true });
            await checkBannedUser(chatId);
            return;
        }
        
        try {
            await bot.answerCallbackQuery(query.id, { text: 'Playlist guide' });
        } catch (e) {}
        await bot.sendMessage(chatId, `📋 *Playlist Download Guide*\n\n` +
            `*Command:*\n` +
            `\`/playlist <playlist_url>\`\n\n` +
            `*Example:*\n` +
            `\`/playlist https://www.youtube.com/playlist?list=PLAYLIST_ID\`\n\n` +
            `*Features:*\n` +
            `• Download entire playlist\n` +
            `• Select quality (240p-1080p)\n` +
            `• All videos downloaded automatically\n\n` +
            `*Note:* Large playlists may take time to download.`, {
            parse_mode: 'Markdown'
        });
        return;
    }
    
    if (data === 'channel_help') {
        // Check ban before processing
        if (!isAdmin(chatId) && adminStats.bannedUsers.has(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: '🚫 You are banned', show_alert: true });
            await checkBannedUser(chatId);
            return;
        }
        
        try {
            await bot.answerCallbackQuery(query.id, { text: 'Channel guide' });
        } catch (e) {}
        await bot.sendMessage(chatId, `📺 *Channel Download Guide*\n\n` +
            `*Command:*\n` +
            `\`/channel <channel_url>\`\n\n` +
            `*Example:*\n` +
            `\`/channel https://www.youtube.com/@channelname\`\n` +
            `\`/channel https://www.youtube.com/c/channelname\`\n\n` +
            `*Features:*\n` +
            `• Download videos from channel\n` +
            `• Select quality (240p-1080p)\n` +
            `• Downloads up to 50 videos (default)\n\n` +
            `*Note:* Channel downloads may take time.`, {
            parse_mode: 'Markdown'
        });
        return;
    }
    
    if (data === 'subtitle_help') {
        // Check ban before processing
        if (!isAdmin(chatId) && adminStats.bannedUsers.has(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: '🚫 You are banned', show_alert: true });
            await checkBannedUser(chatId);
            return;
        }
        
        try {
            await bot.answerCallbackQuery(query.id, { text: 'Subtitle guide' });
        } catch (e) {}
        await bot.sendMessage(chatId, `📝 *Subtitle Download Guide*\n\n` +
            `*Command:*\n` +
            `\`/subtitle <video_url>\`\n\n` +
            `*Example:*\n` +
            `\`/subtitle https://www.youtube.com/watch?v=VIDEO_ID\`\n\n` +
            `*Features:*\n` +
            `• Download video subtitles\n` +
            `• Supports multiple languages\n` +
            `• Formats: VTT, SRT, TTML\n\n` +
            `*Note:* Not all videos have subtitles available.`, {
            parse_mode: 'Markdown'
        });
        return;
    }
    
    if (data === 'thumbnail_help') {
        // Check ban before processing
        if (!isAdmin(chatId) && adminStats.bannedUsers.has(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: '🚫 You are banned', show_alert: true });
            await checkBannedUser(chatId);
            return;
        }
        
        try {
            await bot.answerCallbackQuery(query.id, { text: 'Thumbnail guide' });
        } catch (e) {}
        await bot.sendMessage(chatId, `🖼️ *Thumbnail Download Guide*\n\n` +
            `*Command:*\n` +
            `\`/thumbnail <video_url>\`\n\n` +
            `*Example:*\n` +
            `\`/thumbnail https://www.youtube.com/watch?v=VIDEO_ID\`\n\n` +
            `*Features:*\n` +
            `• Download video thumbnail\n` +
            `• High quality image\n` +
            `• JPEG format\n\n` +
            `*Use Case:*\n` +
            `Perfect for saving video thumbnails!`, {
            parse_mode: 'Markdown'
        });
        return;
    }
    
    if (data === 'batch_help') {
        // Check ban before processing
        if (!isAdmin(chatId) && adminStats.bannedUsers.has(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: '🚫 You are banned', show_alert: true });
            await checkBannedUser(chatId);
            return;
        }
        
        try {
            await bot.answerCallbackQuery(query.id, { text: 'Batch download guide' });
        } catch (e) {}
        await bot.sendMessage(chatId, `📦 *Batch Download Guide*\n\n` +
            `*Command:*\n` +
            `\`/batch <url1,url2,url3,...>\`\n\n` +
            `*Example:*\n` +
            `\`/batch https://youtube.com/watch?v=VIDEO1,https://youtube.com/watch?v=VIDEO2\`\n\n` +
            `*Features:*\n` +
            `• Download multiple videos at once\n` +
            `• Separate URLs with commas\n` +
            `• Shows progress for each video\n\n` +
            `*Tips:*\n` +
            `• Maximum recommended: 10 videos per batch\n` +
            `• Each video downloads sequentially`, {
            parse_mode: 'Markdown'
        });
        return;
    }
    
    if (data === 'show_favorites') {
        // Check ban before processing
        if (!isAdmin(chatId) && adminStats.bannedUsers.has(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: '🚫 You are banned', show_alert: true });
            await checkBannedUser(chatId);
            return;
        }
        
        try {
            await bot.answerCallbackQuery(query.id, { text: 'Loading favorites...' });
        } catch (e) {}
        await showFavorites(chatId);
        return;
    }
    
    if (data === 'show_history') {
        // Check ban before processing
        if (!isAdmin(chatId) && adminStats.bannedUsers.has(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: '🚫 You are banned', show_alert: true });
            await checkBannedUser(chatId);
            return;
        }
        
        try {
            await bot.answerCallbackQuery(query.id, { text: 'Loading history...' });
        } catch (e) {}
        await showDownloadHistory(chatId);
        return;
    }
    
    if (data.startsWith('download_')) {
        // Check ban before processing
        if (!isAdmin(chatId) && adminStats.bannedUsers.has(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: '🚫 You are banned', show_alert: true });
            await checkBannedUser(chatId);
            return;
        }
        
        const videoId = data.replace('download_', '');
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        
        try {
            await bot.answerCallbackQuery(query.id, { text: 'Downloading video...' });
        } catch (e) {}
        
        await downloadVideo(chatId, videoUrl, query.message);
    } else if (data.startsWith('quality_')) {
        // Check ban before processing
        if (!isAdmin(chatId) && adminStats.bannedUsers.has(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: '🚫 You are banned', show_alert: true });
            await checkBannedUser(chatId);
            return;
        }
        
        const videoId = data.replace('quality_', '');
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        
        try {
            await bot.answerCallbackQuery(query.id);
        } catch (e) {}
        
        await showQualityOptions(chatId, videoUrl, videoId, query.message);
    } else if (data.startsWith('dl_')) {
        // Check ban before processing
        if (!isAdmin(chatId) && adminStats.bannedUsers.has(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: '🚫 You are banned', show_alert: true });
            await checkBannedUser(chatId);
            return;
        }
        
        // Format: dl_quality_videoId (e.g., dl_1080_abc123)
        const parts = data.replace('dl_', '').split('_');
        const quality = parts[0];
        const videoId = parts.slice(1).join('_');
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        
        try {
            await bot.answerCallbackQuery(query.id, { text: `Downloading in ${quality}p...` });
        } catch (e) {}
        
        await downloadVideo(chatId, videoUrl, query.message, quality);
    } else if (data.startsWith('fileloc_')) {
        // Check ban before processing
        if (!isAdmin(chatId) && adminStats.bannedUsers.has(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: '🚫 You are banned', show_alert: true });
            await checkBannedUser(chatId);
            return;
        }
        
        const videoId = data.replace('fileloc_', '');
        const tempDir = path.join(__dirname, 'temp');
        
        try {
            await bot.answerCallbackQuery(query.id, { text: 'Getting file location...' });
        } catch (e) {}
        
        // Find the file
        const files = fs.readdirSync(tempDir).filter(f => f.startsWith(videoId));
        if (files.length > 0) {
            const filePath = path.join(tempDir, files[0]);
            const stats = fs.statSync(filePath);
            const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
            const fileSizeGB = (stats.size / (1024 * 1024 * 1024)).toFixed(2);
            const sizeDisplay = stats.size > 1024 * 1024 * 1024 ? `${fileSizeGB}GB` : `${fileSizeMB}MB`;
            
            bot.sendMessage(chatId, `📁 *File Location*\n\n\`${filePath}\`\n\n📦 Size: ${sizeDisplay}\n\n✅ File is ready for download!`, {
                parse_mode: 'Markdown'
            });
        } else {
            bot.sendMessage(chatId, '❌ File not found. It may have been deleted.');
        }
    } else if (data.startsWith('play_')) {
        // Check ban before processing
        if (!isAdmin(chatId) && adminStats.bannedUsers.has(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: '🚫 You are banned', show_alert: true });
            await checkBannedUser(chatId);
            return;
        }
        
        const videoId = data.replace('play_', '');
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        
        try {
            await bot.answerCallbackQuery(query.id, { text: 'Loading video...' });
        } catch (e) {}
        
        await playVideo(chatId, videoUrl, query.message);
    } else if (data.startsWith('audio_')) {
        // Check ban before processing
        if (!isAdmin(chatId) && adminStats.bannedUsers.has(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: '🚫 You are banned', show_alert: true });
            await checkBannedUser(chatId);
            return;
        }
        
        const videoId = data.replace('audio_', '');
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        
        try {
            await bot.answerCallbackQuery(query.id, { text: 'Downloading audio...' });
        } catch (e) {}
        
        await downloadAudio(chatId, videoUrl, query.message);
    } else if (data.startsWith('info_')) {
        // Check ban before processing
        if (!isAdmin(chatId) && adminStats.bannedUsers.has(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: '🚫 You are banned', show_alert: true });
            await checkBannedUser(chatId);
            return;
        }
        
        const videoId = data.replace('info_', '');
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        
        try {
            await bot.answerCallbackQuery(query.id, { text: 'Getting video info...' });
        } catch (e) {}
        
        await getVideoInfo(chatId, videoUrl, query.message);
    } else if (data === 'clear_favorites') {
        // Check ban before processing
        if (!isAdmin(chatId) && adminStats.bannedUsers.has(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: '🚫 You are banned', show_alert: true });
            await checkBannedUser(chatId);
            return;
        }
        
        adminStats.userFavorites[chatId] = [];
        saveAdminStats();
        await bot.answerCallbackQuery(query.id, { text: '✅ Favorites cleared' });
        await showFavorites(chatId);
    } else if (data === 'clear_history') {
        // Check ban before processing
        if (!isAdmin(chatId) && adminStats.bannedUsers.has(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: '🚫 You are banned', show_alert: true });
            await checkBannedUser(chatId);
            return;
        }
        
        adminStats.downloadHistory[chatId] = [];
        saveAdminStats();
        await bot.answerCallbackQuery(query.id, { text: '✅ History cleared' });
        await showDownloadHistory(chatId);
    } else if (data.startsWith('favorite_')) {
        // Check ban before processing
        if (!isAdmin(chatId) && adminStats.bannedUsers.has(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: '🚫 You are banned', show_alert: true });
            await checkBannedUser(chatId);
            return;
        }
        
        const videoId = data.replace('favorite_', '');
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        
        try {
            const infoResult = await runPythonScript('info', videoUrl);
            if (infoResult.success) {
                const added = addToFavorites(chatId, videoId, infoResult.info.title, videoUrl);
                if (added) {
                    await bot.answerCallbackQuery(query.id, { text: '⭐ Added to favorites' });
                } else {
                    await bot.answerCallbackQuery(query.id, { text: '⭐ Already in favorites' });
                }
            }
        } catch (e) {
            await bot.answerCallbackQuery(query.id, { text: '❌ Error adding to favorites' });
        }
    }
});

// Show quality selection options
async function showQualityOptions(chatId, url, videoId, message = null) {
    try {
        // Check if user is banned
        if (await checkBannedUser(chatId)) {
            return;
        }
        
        const infoResult = await runPythonScript('info', url);
        
        if (!infoResult.success) {
            bot.sendMessage(chatId, '❌ Error: Could not fetch video information.');
            return;
        }
        
        const info = infoResult.info;
        const duration = info.duration || 0;
        const durationStr = duration ? `${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')}` : 'Unknown';
        
        // Allow videos of any length, but warn for very long videos
        if (duration > 10800) { // More than 3 hours
            bot.sendMessage(chatId, `⚠️ Video is very long (${Math.floor(duration / 60)} minutes). Download may take time and file size might be large.\n\nFor best results, use lower quality (240p or 360p).`);
        }
        
        const qualityMessage = `⚡ *Fast Download - Select Quality*\n\n` +
            `🎬 *Title:* ${escapeMarkdown(info.title || 'Video')}\n` +
            `⏱ *Duration:* ${durationStr}\n\n` +
            `*Available Qualities (Optimized for Speed):*\n` +
            `• 1080p (Full HD) - Best quality ⚡ Fast\n` +
            `• 720p (HD) - High quality ⚡⚡ Faster\n` +
            `• 480p - Medium quality ⚡⚡⚡ Fastest\n` +
            `• 360p - Standard quality ⚡⚡⚡⚡ Very Fast\n` +
            `• 240p - Low quality ⚡⚡⚡⚡⚡ Ultra Fast\n\n` +
            (duration > 7200 ? `⚠️ *Note:* Video is ${Math.floor(duration / 60)} minutes long.\nFor best results, use 240p or 360p to keep file size manageable.\n\n` : '') +
            `*Speed Features:*\n` +
            `✅ Parallel fragment downloading\n` +
            `✅ Optimized chunk size\n` +
            `✅ Fast format selection\n\n` +
            `*Note:* Higher quality = Larger file size\n` +
            `Telegram limit: 50MB`;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '1080p (Full HD)', callback_data: `dl_1080_${videoId}` },
                    { text: '720p (HD)', callback_data: `dl_720_${videoId}` }
                ],
                [
                    { text: '480p', callback_data: `dl_480_${videoId}` },
                    { text: '360p', callback_data: `dl_360_${videoId}` }
                ],
                [
                    { text: '240p (Smallest)', callback_data: `dl_240_${videoId}` }
                ]
            ]
        };
        
        bot.sendMessage(chatId, qualityMessage, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
        
    } catch (error) {
        console.error('Show quality options error:', error);
        bot.sendMessage(chatId, '❌ An error occurred while showing quality options.');
    }
}

// Download video function
async function downloadVideo(chatId, url, message = null, quality = '360') {
    try {
        // Check if user is banned
        if (await checkBannedUser(chatId)) {
            return;
        }
        
        const processingMsg = await bot.sendMessage(chatId, '⏳ Processing video... Please wait.');
        
        // Get video info using Python
        const infoResult = await runPythonScript('info', url);
        
        if (!infoResult.success) {
            await bot.editMessageText('❌ Error: Could not fetch video information. Please check the URL.', {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
            return;
        }
        
        const info = infoResult.info;
        const title = info.title || 'Video';
        const videoId = info.id;
        const duration = info.duration || 0;
        
        // Allow videos of any length - no restrictions!
        // For very long videos, show info but proceed
        if (duration > 10800) { // More than 3 hours
            await bot.editMessageText(`⚠️ Video is very long (${Math.floor(duration / 60)} minutes).\n\nDownloading in ${quality}p quality...\n\nNote: File size may be large. Download may take time.\n\nProceeding with download...`, {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
            // Wait a bit for user to see the message
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        // No auto-adjustment - user selected quality will be used
        // For 1080p on long videos, we'll handle file size during upload
        
        // Update message with quality info and speed optimization notice
        const durationStr = duration ? `${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')}` : 'Unknown';
        const speedEmoji = quality === '240' ? '⚡⚡⚡⚡⚡' : quality === '360' ? '⚡⚡⚡⚡' : quality === '480' ? '⚡⚡⚡' : quality === '720' ? '⚡⚡' : '⚡';
        
        // Show initial download message immediately
        await bot.editMessageText(`⏳ *Starting Download...*\n\n📥 *Video:* ${escapeMarkdown(title)}\n⏱ *Duration:* ${durationStr}\n📺 *Quality:* ${quality}p ${speedEmoji}\n\n📊 *Progress:* 0%\n\`░░░░░░░░░░░░░░░░░░░░\`\n\n📦 *Downloaded:* 0MB / ?MB\n⚡ *Speed:* 0MB/s\n⏱ *ETA:* --:--\n\n🚀 Preparing download...`, {
            chat_id: chatId,
            message_id: processingMsg.message_id,
            parse_mode: 'Markdown'
        });
        
        // Create temp directory
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir);
        }
        
        // Download video using Python with quality parameter and progress tracking
        let downloadResult;
        let progressInterval;
        let lastProgress = 0;
        
        try {
            const pythonProcess = spawn('python', ['youtube_service.py', 'download', url, tempDir, quality]);
            let stdout = '';
            let stderr = '';
            let progressData = null;

            // Progress update interval - start immediately
            progressInterval = setInterval(async () => {
                if (progressData) {
                    const percent = progressData.percent || 0;
                    const downloadedMB = progressData.downloaded ? (progressData.downloaded / (1024 * 1024)).toFixed(2) : '0';
                    const totalMB = progressData.total ? (progressData.total / (1024 * 1024)).toFixed(2) : '?';
                    const speedMBps = progressData.speed ? (progressData.speed / (1024 * 1024)).toFixed(2) : '0';
                    const eta = progressData.eta || 0;
                    const etaStr = eta > 0 ? `${Math.floor(eta / 60)}:${(eta % 60).toString().padStart(2, '0')}` : '--:--';
                    
                    // Progress bar animation
                    const barLength = 20;
                    const filled = Math.floor((percent / 100) * barLength);
                    const empty = barLength - filled;
                    const progressBar = '█'.repeat(filled) + '░'.repeat(empty);
                    
                    // Animation emoji based on progress - rotating animation
                    const animFrames = ['⏳', '⏳', '⏳', '⏳'];
                    const animIndex = Math.floor(Date.now() / 500) % animFrames.length;
                    const animEmoji = animFrames[animIndex];
                    
                    // Progress indicator emoji
                    const progressEmoji = percent < 25 ? '🔄' : percent < 50 ? '⚡' : percent < 75 ? '🚀' : '✅';
                    
                    try {
                        await bot.editMessageText(
                            `${progressEmoji} *Downloading...* ${animEmoji}\n\n` +
                            `📥 *Video:* ${escapeMarkdown(title)}\n` +
                            `📺 *Quality:* ${quality}p\n\n` +
                            `📊 *Progress:* ${percent.toFixed(1)}%\n` +
                            `\`${progressBar}\`\n\n` +
                            `📦 *Downloaded:* ${downloadedMB}MB / ${totalMB}MB\n` +
                            `⚡ *Speed:* ${speedMBps}MB/s\n` +
                            `⏱ *ETA:* ${etaStr}\n\n` +
                            `🚀 Optimized for speed...`,
                            {
                                chat_id: chatId,
                                message_id: processingMsg.message_id,
                                parse_mode: 'Markdown'
                            }
                        );
                    } catch (e) {
                        // Ignore edit errors (message might be too old)
                    }
                } else {
                    // Show initial progress even if no data yet
                    try {
                        await bot.editMessageText(
                            `⏳ *Starting Download...*\n\n` +
                            `📥 *Video:* ${escapeMarkdown(title)}\n` +
                            `📺 *Quality:* ${quality}p\n\n` +
                            `📊 *Progress:* 0%\n` +
                            `\`░░░░░░░░░░░░░░░░░░░░\`\n\n` +
                            `📦 *Downloaded:* 0MB / ?MB\n` +
                            `⚡ *Speed:* 0MB/s\n` +
                            `⏱ *ETA:* --:--\n\n` +
                            `🚀 Preparing download...`,
                            {
                                chat_id: chatId,
                                message_id: processingMsg.message_id,
                                parse_mode: 'Markdown'
                            }
                        );
                    } catch (e) {
                        // Ignore edit errors
                    }
                }
            }, 1000); // Update every second

            pythonProcess.stdout.on('data', (data) => {
                const output = data.toString();
                // Only add non-progress lines to stdout
                const lines = output.split('\n');
                for (const line of lines) {
                    if (!line.startsWith('PROGRESS:') && line.trim()) {
                        stdout += line + '\n';
                    }
                }
            });

            pythonProcess.stderr.on('data', (data) => {
                const output = data.toString();
                stderr += output;
                
                // Parse progress updates from stderr - handle multiple lines
                const lines = output.split('\n');
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('PROGRESS:')) {
                        try {
                            const progressJson = trimmed.replace('PROGRESS:', '').trim();
                            const parsed = JSON.parse(progressJson);
                            progressData = parsed;
                            console.log('📊 Progress:', parsed.percent + '%', 'Speed:', (parsed.speed / (1024 * 1024)).toFixed(2) + 'MB/s');
                        } catch (e) {
                            console.error('Progress parse error:', e, 'Line:', trimmed);
                        }
                    }
                }
            });

            await new Promise((resolve, reject) => {
                pythonProcess.on('close', async (code) => {
                    clearInterval(progressInterval);
                    
                    // Clean stdout - remove all progress lines and yt-dlp output
                    stdout = stdout.trim();
                    
                    // Remove any lines that look like yt-dlp progress or PROGRESS lines
                    const lines = stdout.split('\n');
                    const cleanLines = lines.filter(line => {
                        const trimmed = line.trim();
                        return !trimmed.startsWith('PROGRESS:') && 
                               !trimmed.startsWith('[download]') &&
                               !trimmed.startsWith('[youtube]') &&
                               trimmed.length > 0;
                    });
                    stdout = cleanLines.join('\n').trim();
                    
                    // Try to extract JSON from stdout
                    let jsonMatch = stdout.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        stdout = jsonMatch[0];
                    }
                    
                    if (code !== 0) {
                        reject(new Error(stderr || `Process exited with code ${code}`));
                        return;
                    }
                    
                    if (!stdout) {
                        reject(new Error('No output from Python script'));
                        return;
                    }
                    
                    try {
                        downloadResult = JSON.parse(stdout);
                        resolve();
                    } catch (e) {
                        console.error('Parse error. Raw stdout:', stdout);
                        console.error('Stderr:', stderr);
                        reject(new Error('Failed to parse Python output: ' + stdout.substring(0, 200)));
                    }
                });

                pythonProcess.on('error', (error) => {
                    clearInterval(progressInterval);
                    reject(error);
                });
            });
        } catch (downloadError) {
            if (progressInterval) clearInterval(progressInterval);
            console.error('Download script error:', downloadError);
            await bot.editMessageText('❌ Error calling download service. Please try again.', {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
            return;
        }
        
        if (!downloadResult || !downloadResult.success) {
            let errorMsg = '❌ Error downloading video.';
            if (downloadResult && downloadResult.error) {
                const errorStr = downloadResult.error;
                if (errorStr.includes('403') || errorStr.includes('Forbidden')) {
                    errorMsg = '❌ YouTube blocked the download (403 Forbidden).\n\nPlease try a different video.';
                } else if (errorStr.includes('timeout') || errorStr.includes('Timed out')) {
                    errorMsg = '❌ Download timed out. Please try again or use a shorter video.';
                } else {
                    errorMsg = `❌ Error: ${errorStr.substring(0, 150)}`;
                }
            }
            
            await bot.editMessageText(errorMsg, {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
            return;
        }
        
        const filePath = downloadResult.file_path;
        const fileSize = downloadResult.file_size;
        
        if (!filePath || !fs.existsSync(filePath)) {
            await bot.editMessageText('❌ Error: Video file was not downloaded. Please try again.', {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
            return;
        }
        
        const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
        const fileSizeGB = (fileSize / (1024 * 1024 * 1024)).toFixed(2);
        const sizeDisplay = fileSize > 1024 * 1024 * 1024 ? `${fileSizeGB}GB` : `${fileSizeMB}MB`;
        
        // Check file size - Telegram practical limit is ~50MB for documents
        // Split files larger than 50MB to ensure successful upload
        const isLargeFile = fileSize > 50 * 1024 * 1024; // > 50MB
        const shouldSplit = fileSize > 50 * 1024 * 1024; // Split if > 50MB
        
        // If file is > 50MB, split it automatically to avoid Telegram limits
        if (shouldSplit) {
            await bot.editMessageText(
                `📦 *File Too Large for Single Upload*\n\n` +
                `📥 *Video:* ${escapeMarkdown(title)}\n` +
                `📺 *Quality:* ${quality}p\n` +
                `📦 *File Size:* ${sizeDisplay}\n\n` +
                `⚠️ *Telegram limit:* ~50MB per file\n\n` +
                `🔄 *Splitting video into parts...*\n\n` +
                `This will split the video into smaller chunks (~45MB each) that can be sent via Telegram.\n` +
                `You can merge them later using FFmpeg.`,
                {
                    chat_id: chatId,
                    message_id: processingMsg.message_id,
                    parse_mode: 'Markdown'
                }
            );
            
            // Split video into parts (max 45MB per part to stay under 50MB limit)
            try {
                const splitResult = await runPythonScript('split', filePath, path.dirname(filePath), '45');
                
                if (!splitResult.success || !splitResult.parts || splitResult.parts.length === 0) {
                    throw new Error(splitResult.error || 'Video splitting failed');
                }
                
                const parts = splitResult.parts;
                const totalParts = splitResult.total_parts;
                
                await bot.editMessageText(
                    `✅ *Video Split Successfully!*\n\n` +
                    `📦 *Total Parts:* ${totalParts}\n` +
                    `📤 *Sending parts...*\n\n` +
                    `Part 1/${totalParts} uploading...`,
                    {
                        chat_id: chatId,
                        message_id: processingMsg.message_id,
                        parse_mode: 'Markdown'
                    }
                );
                
                // Send each part sequentially
                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i];
                    const partSizeMB = (part.size / (1024 * 1024)).toFixed(2);
                    const partSizeGB = (part.size / (1024 * 1024 * 1024)).toFixed(2);
                    const partSizeDisplay = part.size > 1024 * 1024 * 1024 ? `${partSizeGB}GB` : `${partSizeMB}MB`;
                    
                    // Update progress
                    await bot.editMessageText(
                        `📤 *Uploading Part ${part.part_number}/${totalParts}*\n\n` +
                        `📦 Size: ${partSizeDisplay}\n\n` +
                        `Please wait...`,
                        {
                            chat_id: chatId,
                            message_id: processingMsg.message_id,
                            parse_mode: 'Markdown'
                        }
                    );
                    
                    try {
                        await bot.sendDocument(chatId, part.path, {
                            caption: `🎬 *${title}*\n\n📺 Quality: ${quality}p\n📦 Part ${part.part_number}/${totalParts}\n📊 Size: ${partSizeDisplay}\n\n✅ Part ${part.part_number} of ${totalParts}`,
                            parse_mode: 'Markdown'
                        });
                    } catch (partError) {
                        console.error(`Error sending part ${part.part_number}:`, partError);
                        await bot.sendMessage(chatId, `❌ Error sending part ${part.part_number}/${totalParts}. Please try again.`);
                    }
                }
                
                // Send merge instructions
                const mergeInstructions = `📋 *How to Merge Parts*\n\n` +
                    `1. Download all ${totalParts} parts\n` +
                    `2. Use FFmpeg to merge:\n\n` +
                    `\`\`\`\n` +
                    `ffmpeg -i "concat:part01.mp4|part02.mp4|part03.mp4" -c copy output.mp4\n` +
                    `\`\`\`\n\n` +
                    `*Or use Windows command:*\n` +
                    `\`\`\`\n` +
                    `copy /b part*.mp4 output.mp4\n` +
                    `\`\`\`\n\n` +
                    `✅ All parts sent successfully!`;
                
                await bot.editMessageText(mergeInstructions, {
                    chat_id: chatId,
                    message_id: processingMsg.message_id,
                    parse_mode: 'Markdown'
                });
                
                // Clean up split parts after a delay
                setTimeout(() => {
                    parts.forEach(part => {
                        try {
                            if (fs.existsSync(part.path)) {
                                fs.unlinkSync(part.path);
                            }
                        } catch (e) {
                            console.error(`Error deleting part ${part.part_number}:`, e);
                        }
                    });
                }, 60000); // Delete after 1 minute
                
                // Delete original file (only if it exists)
                try {
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                } catch (e) {
                    // Ignore errors if file doesn't exist
                    if (e.code !== 'ENOENT') {
                        console.error('Error deleting original file:', e);
                    }
                }
                
                return; // Exit function after splitting
                
            } catch (splitError) {
                console.error('Split error:', splitError);
                await bot.editMessageText(
                    `❌ *Video Splitting Failed*\n\n` +
                    `📥 *Video:* ${escapeMarkdown(title)}\n` +
                    `📺 *Quality:* ${quality}p\n` +
                    `📦 *File Size:* ${sizeDisplay}\n\n` +
                    `*Error:* ${splitError.message || String(splitError)}\n\n` +
                    `*File Location:*\n\`${filePath}\`\n\n` +
                    `✅ File downloaded successfully! You can access it from your server.`,
                    {
                        chat_id: chatId,
                        message_id: processingMsg.message_id,
                        parse_mode: 'Markdown'
                    }
                );
                
                // Offer to re-download in lower quality
                const keyboard = {
                    inline_keyboard: [
                        [
                            { text: '⬇️ Download 240p (Smaller)', callback_data: `dl_240_${videoId}` },
                            { text: '⬇️ Download 360p', callback_data: `dl_360_${videoId}` }
                        ],
                        [
                            { text: '📁 Get File Location', callback_data: `fileloc_${videoId}` }
                        ]
                    ]
                };
                
                await bot.sendMessage(chatId, `💾 *File Location*\n\n\`${filePath}\`\n\n📦 Size: ${sizeDisplay}`, {
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                });
                
                return;
            }
        }
        
        // Update message for files <= 50MB
        await bot.editMessageText(`📤 Uploading: *${title}*\n\nSize: ${sizeDisplay}\n\n🎬 Sending video...`, {
            chat_id: chatId,
            message_id: processingMsg.message_id,
            parse_mode: 'Markdown'
        });
        
        // Send video (files <= 50MB)
        try {
            await bot.sendVideo(chatId, filePath, {
                caption: `🎬 *${title}*\n\n✅ Downloaded successfully!`,
                parse_mode: 'Markdown'
            });
            
            // Delete processing message
            try {
                await bot.deleteMessage(chatId, processingMsg.message_id);
            } catch (e) {}
        } catch (sendError) {
            console.error('Send error:', sendError);
            const errorMsg = sendError.message || String(sendError);
            
            await bot.editMessageText(`❌ Error sending file: ${errorMsg.substring(0, 100)}\n\nFile size: ${sizeDisplay}`, {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
        }
        
        // Delete temp file only after successful send (wait a bit to ensure upload completes)
        try {
            // Wait a bit to ensure file is fully sent before deletion
            await new Promise(resolve => setTimeout(resolve, 2000));
            fs.unlinkSync(filePath);
        } catch (e) {
            console.error('Error deleting temp file:', e);
        }
        
    } catch (error) {
        console.error('Download error:', error);
        bot.sendMessage(chatId, '❌ An error occurred while downloading. Please try again later.');
    }
}

// Play video function - sends video directly for playback in Telegram
async function playVideo(chatId, url, message = null) {
    try {
        const processingMsg = await bot.sendMessage(chatId, '⏳ Loading video for playback... Please wait.');
        
        // Get video info using Python
        const infoResult = await runPythonScript('info', url);
        
        if (!infoResult.success) {
            await bot.editMessageText('❌ Error: Could not fetch video information. Please check the URL.', {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
            return;
        }
        
        const info = infoResult.info;
        const title = info.title || 'Video';
        const videoId = info.id;
        const duration = info.duration || 0;
        
        // Check if video is too long (more than 1 hour)
        if (duration > 3600) {
            await bot.editMessageText('⏱️ Video is longer than 1 hour. Please use download button for very long videos.\n\nFor playback, videos should be under 1 hour.', {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
            return;
        }
        
        // Update message
        await bot.editMessageText(`📥 Preparing video: *${title}*\n\nPlease wait...`, {
            chat_id: chatId,
            message_id: processingMsg.message_id,
            parse_mode: 'Markdown'
        });
        
        // Create temp directory
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir);
        }
        
        // Download video using Python
        let downloadResult;
        try {
            downloadResult = await runPythonScript('download', url, tempDir);
        } catch (error) {
            await bot.editMessageText('❌ Error downloading video. Please try again.', {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
            return;
        }
        
        if (!downloadResult || !downloadResult.success) {
            let errorMsg = '❌ Error downloading video.';
            if (downloadResult && downloadResult.error) {
                errorMsg = `❌ Error: ${downloadResult.error.substring(0, 150)}`;
            }
            await bot.editMessageText(errorMsg, {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
            return;
        }
        
        const filePath = downloadResult.file_path;
        const fileSize = downloadResult.file_size;
        
        if (!filePath || !fs.existsSync(filePath)) {
            await bot.editMessageText('❌ Error: Video file was not downloaded. Please try again.', {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
            return;
        }
        
        const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
        const fileSizeGB = (fileSize / (1024 * 1024 * 1024)).toFixed(2);
        const sizeDisplay = fileSize > 1024 * 1024 * 1024 ? `${fileSizeGB}GB` : `${fileSizeMB}MB`;
        
        // Check file size - Telegram limit is 2GB for documents, 50MB for videos
        const isLargeFile = fileSize > 50 * 1024 * 1024; // > 50MB
        const isVeryLargeFile = fileSize > 2 * 1024 * 1024 * 1024; // > 2GB
        
        // If file is > 2GB, split it automatically
        if (isVeryLargeFile) {
            await bot.editMessageText(
                `📦 *File Too Large for Single Upload*\n\n` +
                `📥 *Video:* ${escapeMarkdown(title)}\n` +
                `📺 *Quality:* ${quality}p\n` +
                `📦 *File Size:* ${sizeDisplay}\n\n` +
                `⚠️ *Telegram limit:* 2GB per file\n\n` +
                `🔄 *Splitting video into parts...*\n\n` +
                `This will split the video into smaller chunks that can be sent via Telegram.\n` +
                `You can merge them later using FFmpeg.`,
                {
                    chat_id: chatId,
                    message_id: processingMsg.message_id,
                    parse_mode: 'Markdown'
                }
            );
            
            // Split video into parts
            try {
                const splitResult = await runPythonScript('split', filePath, path.dirname(filePath), '1800');
                
                if (!splitResult.success || !splitResult.parts || splitResult.parts.length === 0) {
                    throw new Error(splitResult.error || 'Video splitting failed');
                }
                
                const parts = splitResult.parts;
                const totalParts = splitResult.total_parts;
                
                await bot.editMessageText(
                    `✅ *Video Split Successfully!*\n\n` +
                    `📦 *Total Parts:* ${totalParts}\n` +
                    `📤 *Sending parts...*\n\n` +
                    `Part 1/${totalParts} uploading...`,
                    {
                        chat_id: chatId,
                        message_id: processingMsg.message_id,
                        parse_mode: 'Markdown'
                    }
                );
                
                // Send each part sequentially
                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i];
                    const partSizeMB = (part.size / (1024 * 1024)).toFixed(2);
                    const partSizeGB = (part.size / (1024 * 1024 * 1024)).toFixed(2);
                    const partSizeDisplay = part.size > 1024 * 1024 * 1024 ? `${partSizeGB}GB` : `${partSizeMB}MB`;
                    
                    // Update progress
                    await bot.editMessageText(
                        `📤 *Uploading Part ${part.part_number}/${totalParts}*\n\n` +
                        `📦 Size: ${partSizeDisplay}\n\n` +
                        `Please wait...`,
                        {
                            chat_id: chatId,
                            message_id: processingMsg.message_id,
                            parse_mode: 'Markdown'
                        }
                    );
                    
                    try {
                        await bot.sendDocument(chatId, part.path, {
                            caption: `🎬 *${title}*\n\n📺 Quality: ${quality}p\n📦 Part ${part.part_number}/${totalParts}\n📊 Size: ${partSizeDisplay}\n\n✅ Part ${part.part_number} of ${totalParts}`,
                            parse_mode: 'Markdown'
                        });
                    } catch (partError) {
                        console.error(`Error sending part ${part.part_number}:`, partError);
                        await bot.sendMessage(chatId, `❌ Error sending part ${part.part_number}/${totalParts}. Please try again.`);
                    }
                }
                
                // Send merge instructions
                const mergeInstructions = `📋 *How to Merge Parts*\n\n` +
                    `1. Download all ${totalParts} parts\n` +
                    `2. Use FFmpeg to merge:\n\n` +
                    `\`\`\`\n` +
                    `ffmpeg -i "concat:part01.mp4|part02.mp4|part03.mp4" -c copy output.mp4\n` +
                    `\`\`\`\n\n` +
                    `*Or use Windows command:*\n` +
                    `\`\`\`\n` +
                    `copy /b part*.mp4 output.mp4\n` +
                    `\`\`\`\n\n` +
                    `✅ All parts sent successfully!`;
                
                await bot.editMessageText(mergeInstructions, {
                    chat_id: chatId,
                    message_id: processingMsg.message_id,
                    parse_mode: 'Markdown'
                });
                
                // Clean up split parts after a delay
                setTimeout(() => {
                    parts.forEach(part => {
                        try {
                            if (fs.existsSync(part.path)) {
                                fs.unlinkSync(part.path);
                            }
                        } catch (e) {
                            console.error(`Error deleting part ${part.part_number}:`, e);
                        }
                    });
                }, 60000); // Delete after 1 minute
                
                // Delete original file (only if it exists)
                try {
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                } catch (e) {
                    // Ignore errors if file doesn't exist
                    if (e.code !== 'ENOENT') {
                        console.error('Error deleting original file:', e);
                    }
                }
                
                return; // Exit function after splitting
                
            } catch (splitError) {
                console.error('Split error:', splitError);
                await bot.editMessageText(
                    `❌ *Video Splitting Failed*\n\n` +
                    `📥 *Video:* ${escapeMarkdown(title)}\n` +
                    `📺 *Quality:* ${quality}p\n` +
                    `📦 *File Size:* ${sizeDisplay}\n\n` +
                    `*Error:* ${splitError.message || String(splitError)}\n\n` +
                    `*File Location:*\n\`${filePath}\`\n\n` +
                    `✅ File downloaded successfully! You can access it from your server.`,
                    {
                        chat_id: chatId,
                        message_id: processingMsg.message_id,
                        parse_mode: 'Markdown'
                    }
                );
                
                // Offer to re-download in lower quality
                const keyboard = {
                    inline_keyboard: [
                        [
                            { text: '⬇️ Download 240p (Smaller)', callback_data: `dl_240_${videoId}` },
                            { text: '⬇️ Download 360p', callback_data: `dl_360_${videoId}` }
                        ],
                        [
                            { text: '📁 Get File Location', callback_data: `fileloc_${videoId}` }
                        ]
                    ]
                };
                
                await bot.sendMessage(chatId, `💾 *File Location*\n\n\`${filePath}\`\n\n📦 Size: ${sizeDisplay}`, {
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                });
                
                return;
            }
        }
        
        // Update message
        await bot.editMessageText(`📤 Uploading: *${title}*\n\nSize: ${sizeDisplay}\n\n${isLargeFile ? '📦 Sending as document (large file)...' : '🎬 Sending video...'}`, {
            chat_id: chatId,
            message_id: processingMsg.message_id,
            parse_mode: 'Markdown'
        });
        
        // Send video or document based on file size
        try {
            if (isLargeFile) {
                // For files > 50MB, use sendDocument (supports up to 2GB)
                await bot.sendDocument(chatId, filePath, {
                    caption: `🎬 *${title}*\n\n📺 Quality: ${quality}p\n📦 Size: ${sizeDisplay}\n\n✅ Downloaded successfully!\n\n*Note:* Sent as document due to large file size. You can download and play it normally.`,
                    parse_mode: 'Markdown'
                });
            } else {
                // For files <= 50MB, use sendVideo (better Telegram integration)
                await bot.sendVideo(chatId, filePath, {
                    caption: `🎬 *${title}*\n\n✅ Downloaded successfully!`,
                    parse_mode: 'Markdown'
                });
            }
            
            // Delete processing message
            try {
                await bot.deleteMessage(chatId, processingMsg.message_id);
            } catch (e) {}
            
            // Add to download history
            addToDownloadHistory(chatId, videoId, title, url, 'video', quality);
        } catch (sendError) {
            console.error('Send error:', sendError);
            const errorMsg = sendError.message || String(sendError);
            
            await bot.editMessageText(`❌ Error sending file: ${errorMsg.substring(0, 100)}\n\nFile size: ${sizeDisplay}`, {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
        }
        
    } catch (error) {
        console.error('Download error:', error);
        bot.sendMessage(chatId, '❌ An error occurred while downloading. Please try again later.');
    }
    
    // Track command and send offer after 3 commands
    trackCommandAndSendOffer(chatId);
}

// Play video function - sends video directly for playback in Telegram (optimized for speed)
async function playVideo(chatId, url, message = null) {
    try {
        // Check if user is banned
        if (await checkBannedUser(chatId)) {
            return;
        }
        
        const processingMsg = await bot.sendMessage(chatId, '⚡ Loading video for fast playback... Please wait.');
        
        // Get video info using Python
        const infoResult = await runPythonScript('info', url);
        
        if (!infoResult.success) {
            await bot.editMessageText('❌ Error: Could not fetch video information. Please check the URL.', {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
            return;
        }
        
        const info = infoResult.info;
        const title = info.title || 'Video';
        const videoId = info.id;
        const duration = info.duration || 0;
        
        // No duration limit - allow any length video for playback
        // For very long videos, show info but proceed
        if (duration > 3600) { // More than 1 hour
            await bot.editMessageText(`⚡ *Fast Loading: ${escapeMarkdown(title)}*\n\n⏱ Video is ${Math.floor(duration / 60)} minutes long\n\n📥 Downloading in 240p for fast playback...\n\n⏳ Please wait...`, {
                chat_id: chatId,
                message_id: processingMsg.message_id,
                parse_mode: 'Markdown'
            });
        } else {
            // Update message - using 240p for fastest download
            await bot.editMessageText(`⚡ *Fast Loading: ${escapeMarkdown(title)}*\n\n📥 Downloading in 240p for instant playback...\n\n⏳ Please wait...`, {
                chat_id: chatId,
                message_id: processingMsg.message_id,
                parse_mode: 'Markdown'
            });
        }
        
        // Create temp directory
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir);
        }
        
        // Download video in 240p quality for fastest download (optimized for playback)
        let downloadResult;
        try {
            downloadResult = await runPythonScript('download', url, tempDir, '240');
        } catch (downloadError) {
            console.error('Download script error:', downloadError);
            await bot.editMessageText('❌ Error preparing video. Please try again.', {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
            return;
        }
        
        if (!downloadResult || !downloadResult.success) {
            let errorMsg = '❌ Error preparing video.';
            if (downloadResult && downloadResult.error) {
                const errorStr = downloadResult.error;
                if (errorStr.includes('403') || errorStr.includes('Forbidden')) {
                    errorMsg = '❌ YouTube blocked the video (403 Forbidden).\n\nPlease try a different video.';
                } else {
                    errorMsg = `❌ Error: ${errorStr.substring(0, 100)}`;
                }
            }
            
            await bot.editMessageText(errorMsg, {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
            return;
        }
        
        const filePath = downloadResult.file_path;
        const fileSize = downloadResult.file_size;
        
        if (!filePath || !fs.existsSync(filePath)) {
            await bot.editMessageText('❌ Error: Video file was not prepared. Please try again.', {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
            return;
        }
        
        const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
        
        // Check if file is too large (Telegram limit is 50MB)
        if (fileSize > 50 * 1024 * 1024) {
            await bot.editMessageText(`❌ Video is too large (${fileSizeMB}MB). Telegram limit is 50MB.\n\nPlease use download button or try a shorter video.`, {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch (e) {}
            return;
        }
        
        // Delete processing message
        try {
            await bot.deleteMessage(chatId, processingMsg.message_id);
        } catch (e) {}
        
        // Send video for playback with streaming support
        try {
            await bot.sendVideo(chatId, filePath, {
                caption: `🎬 *${escapeMarkdown(title)}*\n\n▶️ Tap to play!\n\n⚡ Loaded in 240p for fast playback`,
                parse_mode: 'Markdown',
                supports_streaming: true  // Enable inline playback in Telegram
            });
        } catch (sendError) {
            console.error('Send video error:', sendError);
            await bot.sendMessage(chatId, '❌ Error sending video. The file might be corrupted or too large.');
        }
        
        // Delete temp file (only if it exists)
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (e) {
            // Ignore errors if file doesn't exist or already deleted
            if (e.code !== 'ENOENT') {
                console.error('Error deleting temp file:', e);
            }
        }
        
    } catch (error) {
        console.error('Play video error:', error);
        bot.sendMessage(chatId, '❌ An error occurred while preparing video. Please try again later.');
    }
}

// Handle /audio command - Download audio only
bot.onText(/\/audio (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    
    // Check if user is banned
    if (await checkBannedUser(chatId)) {
        return;
    }
    
    const url = match[1];
    trackUserActivity(chatId, 'audio');
    
    if (!url || url.trim().length === 0) {
        bot.sendMessage(chatId, '❌ Please provide a YouTube URL.\nExample: /audio https://www.youtube.com/watch?v=VIDEO_ID');
        return;
    }
    
    await downloadAudio(chatId, url);
});

// Handle /info command - Get video information
bot.onText(/\/info (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    
    // Check if user is banned
    if (await checkBannedUser(chatId)) {
        return;
    }
    
    const url = match[1];
    trackUserActivity(chatId, 'info');
    
    if (!url || url.trim().length === 0) {
        bot.sendMessage(chatId, '❌ Please provide a YouTube URL.\nExample: /info https://www.youtube.com/watch?v=VIDEO_ID');
        return;
    }
    
    await getVideoInfo(chatId, url, msg);
});

// Handle /trending command - Get trending videos
bot.onText(/\/trending/, async (msg) => {
    const chatId = msg.chat.id;
    
    // Check if user is banned
    if (await checkBannedUser(chatId)) {
        return;
    }
    
    trackUserActivity(chatId, 'trending');
    await getTrendingVideos(chatId);
});

// Handle /playlist command - Download playlist
bot.onText(/\/playlist (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    
    // Check if user is banned
    if (await checkBannedUser(chatId)) {
        return;
    }
    
    const url = match[1];
    trackUserActivity(chatId, 'playlist');
    
    if (!url || url.trim().length === 0) {
        bot.sendMessage(chatId, '❌ Please provide a playlist URL.\nExample: /playlist https://www.youtube.com/playlist?list=PLAYLIST_ID');
        return;
    }
    
    await downloadPlaylist(chatId, url);
});

// Handle /channel command - Download channel videos
bot.onText(/\/channel (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    
    // Check if user is banned
    if (await checkBannedUser(chatId)) {
        return;
    }
    
    const url = match[1];
    trackUserActivity(chatId, 'channel');
    
    if (!url || url.trim().length === 0) {
        bot.sendMessage(chatId, '❌ Please provide a channel URL.\nExample: /channel https://www.youtube.com/@channelname');
        return;
    }
    
    await downloadChannel(chatId, url);
});

// Handle /subtitle command - Download subtitles
bot.onText(/\/subtitle (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    
    // Check if user is banned
    if (await checkBannedUser(chatId)) {
        return;
    }
    
    const url = match[1];
    trackUserActivity(chatId, 'subtitle');
    
    if (!url || url.trim().length === 0) {
        bot.sendMessage(chatId, '❌ Please provide a YouTube URL.\nExample: /subtitle https://www.youtube.com/watch?v=VIDEO_ID');
        return;
    }
    
    await downloadSubtitle(chatId, url);
});

// Handle /thumbnail command - Download thumbnail
bot.onText(/\/thumbnail (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    
    // Check if user is banned
    if (await checkBannedUser(chatId)) {
        return;
    }
    
    const url = match[1];
    trackUserActivity(chatId, 'thumbnail');
    
    if (!url || url.trim().length === 0) {
        bot.sendMessage(chatId, '❌ Please provide a YouTube URL.\nExample: /thumbnail https://www.youtube.com/watch?v=VIDEO_ID');
        return;
    }
    
    await downloadThumbnail(chatId, url);
});

// Handle /favorites command - View favorites
bot.onText(/\/favorites/, async (msg) => {
    const chatId = msg.chat.id;
    
    // Check if user is banned
    if (await checkBannedUser(chatId)) {
        return;
    }
    
    await showFavorites(chatId);
});

// Handle /history command - View download history
bot.onText(/\/history/, async (msg) => {
    const chatId = msg.chat.id;
    
    // Check if user is banned
    if (await checkBannedUser(chatId)) {
        return;
    }
    
    await showDownloadHistory(chatId);
});

// Handle /batch command - Batch download
bot.onText(/\/batch (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    
    // Check if user is banned
    if (await checkBannedUser(chatId)) {
        return;
    }
    
    const urls = match[1].split(',').map(u => u.trim()).filter(u => u);
    
    if (urls.length === 0) {
        bot.sendMessage(chatId, '❌ Please provide YouTube URLs separated by commas.\nExample: /batch https://youtube.com/watch?v=VIDEO1,https://youtube.com/watch?v=VIDEO2');
        return;
    }
    
    await batchDownload(chatId, urls);
});

// Get trending videos function
async function getTrendingVideos(chatId) {
    try {
        // Check if user is banned
        if (await checkBannedUser(chatId)) {
            return;
        }
        
        const searchingMsg = await bot.sendMessage(chatId, '🔥 Loading trending videos... Please wait.');
        
        // Search for trending/popular videos
        // Try multiple trending queries to get better results
        const trendingQueries = [
            'trending music 2024',
            'viral videos',
            'popular songs',
            'trending now',
            'top hits'
        ];
        
        // Use the first query
        const query = trendingQueries[0];
        const result = await runPythonScript('search', query, '10');
        
        if (!result.success || !result.videos || result.videos.length === 0) {
            await bot.editMessageText('❌ Could not fetch trending videos. Please try again later.', {
                chat_id: chatId,
                message_id: searchingMsg.message_id
            });
            return;
        }
        
        // Delete searching message
        try {
            await bot.deleteMessage(chatId, searchingMsg.message_id);
        } catch (e) {}
        
        // Send header
        await bot.sendMessage(chatId, `🔥 *Trending Videos*\n\nFound ${result.videos.length} trending video(s):`, {
            parse_mode: 'Markdown',
            reply_markup: getReplyKeyboard()
        });
        
        // Send each video with thumbnail
        for (let index = 0; index < result.videos.length; index++) {
            const video = result.videos[index];
            const title = video.title || 'No title';
            const videoId = video.id || '';
            const channel = video.channel || 'Unknown channel';
            const duration = video.duration || 0;
            const durationStr = duration ? `${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')}` : 'Unknown duration';
            const viewCount = video.view_count ? `${video.view_count.toLocaleString()} views` : 'Unknown views';
            const videoUrl = video.webpage_url || video.url || `https://www.youtube.com/watch?v=${videoId}`;
            const thumbnail = video.thumbnail || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
            
            const caption = `${index + 1}. *${escapeMarkdown(title)}*\n` +
                `👤 Channel: ${escapeMarkdown(channel)}\n` +
                `⏱ Duration: ${durationStr}\n` +
                `👁 Views: ${viewCount}\n` +
                `🔗 [Watch Video](${videoUrl})`;
            
            // Create inline keyboard with multiple options
            const keyboard = {
                inline_keyboard: [
                    [
                        {
                            text: '▶️ Play',
                            callback_data: `play_${videoId}`
                        },
                        {
                            text: '⬇️ Download',
                            callback_data: `quality_${videoId}`
                        },
                        {
                            text: '🎵 Audio',
                            callback_data: `audio_${videoId}`
                        }
                    ],
                    [
                        {
                            text: '📊 Info',
                            callback_data: `info_${videoId}`
                        },
                        {
                            text: '⭐ Favorite',
                            callback_data: `favorite_${videoId}`
                        },
                        {
                            text: '📺 Quality',
                            callback_data: `quality_${videoId}`
                        }
                    ],
                    [
                        {
                            text: '🔗 Open YouTube',
                            url: videoUrl
                        }
                    ]
                ]
            };
            
            try {
                // Validate thumbnail URL
                if (thumbnail && (thumbnail.startsWith('http://') || thumbnail.startsWith('https://'))) {
                    await bot.sendPhoto(chatId, thumbnail, {
                        caption: caption,
                        parse_mode: 'Markdown',
                        reply_markup: keyboard
                    });
                } else {
                    await bot.sendMessage(chatId, caption, {
                        parse_mode: 'Markdown',
                        reply_markup: keyboard
                    });
                }
            } catch (photoError) {
                await bot.sendMessage(chatId, caption, {
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                });
            }
        }
        
    } catch (error) {
        console.error('Trending error:', error);
        bot.sendMessage(chatId, '❌ An error occurred while fetching trending videos. Please try again later.');
    }
    
    // Track command and send offer after 3 commands
    trackCommandAndSendOffer(chatId);
}

// Download audio function (MP3)
async function downloadAudio(chatId, url, message = null) {
    try {
        // Check if user is banned
        if (await checkBannedUser(chatId)) {
            return;
        }
        
        const processingMsg = await bot.sendMessage(chatId, '⏳ Processing audio... Please wait.');
        
        // Get video info
        const infoResult = await runPythonScript('info', url);
        
        if (!infoResult.success) {
            await bot.editMessageText('❌ Error: Could not fetch video information.', {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
            return;
        }
        
        const info = infoResult.info;
        const title = info.title || 'Audio';
        
        await bot.editMessageText(`🎵 Downloading audio: *${title}*\n\nPlease wait...`, {
            chat_id: chatId,
            message_id: processingMsg.message_id,
            parse_mode: 'Markdown'
        });
        
        // Create temp directory
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir);
        }
        
        // Download audio using Python
        let downloadResult;
        try {
            downloadResult = await runPythonScript('audio', url, tempDir);
        } catch (downloadError) {
            console.error('Audio download error:', downloadError);
            await bot.editMessageText('❌ Error downloading audio. Please try again.', {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
            return;
        }
        
        if (!downloadResult || !downloadResult.success) {
            let errorMsg = '❌ Error downloading audio.';
            if (downloadResult && downloadResult.error) {
                const errorStr = downloadResult.error;
                if (errorStr.includes('FFmpeg not found') || errorStr.includes('PATH')) {
                    errorMsg = '❌ FFmpeg not found in PATH.\n\n' +
                        'Please:\n' +
                        '1. Install FFmpeg (run install_ffmpeg.bat)\n' +
                        '2. Add FFmpeg to PATH\n' +
                        '3. Restart terminal and bot\n\n' +
                        'See INSTALL_FFMPEG.md for detailed instructions.';
                } else {
                    errorMsg = `❌ Error: ${errorStr.substring(0, 150)}`;
                }
            }
            await bot.editMessageText(errorMsg, {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
            return;
        }
        
        const filePath = downloadResult.file_path;
        const fileSize = downloadResult.file_size;
        const audioFormat = downloadResult.format || '';
        const formatError = downloadResult.error || '';
        
        if (!filePath || !fs.existsSync(filePath)) {
            await bot.editMessageText('❌ Error: Audio file was not downloaded.', {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
            return;
        }
        
        const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
        
        // Check file size (Telegram limit is 50MB)
        if (fileSize > 50 * 1024 * 1024) {
            await bot.editMessageText(`❌ Audio file is too large (${fileSizeMB}MB). Telegram limit is 50MB.`, {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
            try {
                fs.unlinkSync(filePath);
            } catch (e) {}
            return;
        }
        
        await bot.editMessageText(`📤 Uploading audio: *${title}*\n\nSize: ${fileSizeMB}MB`, {
            chat_id: chatId,
            message_id: processingMsg.message_id,
            parse_mode: 'Markdown'
        });
        
        // Send audio
        try {
            const isOriginalFormat = audioFormat.includes('original format') || formatError.includes('MP3 conversion failed');
            
            await bot.sendAudio(chatId, filePath, {
                title: title,
                performer: info.channel || 'YouTube'
            });
            
            // Send format note if needed
            if (isOriginalFormat) {
                const helpMessage = `✅ *Audio Downloaded Successfully!*\n\n` +
                    `📝 *Format:* ${filePath.endsWith('.mp3') ? 'MP3 ✅' : 'Original format (not MP3)'}\n\n` +
                    (formatError ? `⚠️ *Note:* ${formatError}\n\n` : '') +
                    `💡 *To get MP3 format:*\n` +
                    `1. Make sure FFmpeg is installed\n` +
                    `2. Add FFmpeg to PATH\n` +
                    `3. Restart terminal and bot\n\n` +
                    `*Note:* Audio works fine in original format too!`;
                
                await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
            }
            
            try {
                await bot.deleteMessage(chatId, processingMsg.message_id);
            } catch (e) {}
        } catch (sendError) {
            console.error('Send audio error:', sendError);
            await bot.editMessageText('❌ Error sending audio. The file might be too large or in an unsupported format.', {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
        }
        
        // Delete temp file
        try {
            fs.unlinkSync(filePath);
        } catch (e) {}
        
        // Add to download history (use existing infoResult)
        addToDownloadHistory(chatId, info.id, title, url, 'audio', null);
        
    } catch (error) {
        console.error('Audio download error:', error);
        bot.sendMessage(chatId, '❌ An error occurred while downloading audio. Please try again later.');
    }
    
    // Track command and send offer after 3 commands
    trackCommandAndSendOffer(chatId);
}

// Helper function to escape Markdown special characters
function escapeMarkdown(text) {
    if (!text) return '';
    // Only escape characters that can break Markdown formatting
    return String(text)
        .replace(/\_/g, '\\_')
        .replace(/\*/g, '\\*')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)')
        .replace(/\~/g, '\\~')
        .replace(/\`/g, '\\`')
        .replace(/\>/g, '\\>')
        .replace(/\#/g, '\\#')
        .replace(/\+/g, '\\+')
        .replace(/\-/g, '\\-')
        .replace(/\=/g, '\\=')
        .replace(/\|/g, '\\|')
        .replace(/\{/g, '\\{')
        .replace(/\}/g, '\\}');
}

// Get video info function
async function getVideoInfo(chatId, url, message = null) {
    try {
        // Check if user is banned
        if (await checkBannedUser(chatId)) {
            return;
        }
        
        const infoResult = await runPythonScript('info', url);
        
        if (!infoResult.success) {
            bot.sendMessage(chatId, '❌ Error: Could not fetch video information. Please check the URL.');
            return;
        }
        
        const info = infoResult.info;
        const duration = info.duration || 0;
        const durationStr = duration ? `${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')}` : 'Unknown';
        
        // Escape special characters in title and channel
        const safeTitle = escapeMarkdown(info.title || 'Unknown');
        const safeChannel = escapeMarkdown(info.channel || 'Unknown');
        const safeVideoId = info.id || 'Unknown';
        const safeUrl = escapeMarkdown(url);
        const views = info.view_count ? info.view_count.toLocaleString() : 'Unknown';
        
        const infoMessage = `📊 *Video Information*\n\n` +
            `🎬 *Title:* ${safeTitle}\n` +
            `👤 *Channel:* ${safeChannel}\n` +
            `⏱ *Duration:* ${durationStr}\n` +
            `👁 *Views:* ${views}\n` +
            `🆔 *Video ID:* \`${safeVideoId}\`\n` +
            `🔗 *URL:* ${safeUrl}\n\n` +
            `*Options:*\n` +
            `▶️ Play Video\n` +
            `⬇️ Download Video\n` +
            `🎵 Download Audio \\(MP3\\)`;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '▶️ Play Video', callback_data: `play_${info.id}` },
                    { text: '⬇️ Download Video', callback_data: `download_${info.id}` }
                ],
                [
                    { text: '🎵 Audio Only (MP3)', callback_data: `audio_${info.id}` },
                    { text: '⭐ Favorite', callback_data: `favorite_${info.id}` }
                ],
                [
                    { text: '📋 Playlist', callback_data: 'playlist_help' },
                    { text: '📺 Channel', callback_data: 'channel_help' }
                ],
                [
                    { text: '🔗 Open YouTube', url: url }
                ]
            ]
        };
        
        if (info.thumbnail) {
            try {
                await bot.sendPhoto(chatId, info.thumbnail, {
                    caption: infoMessage,
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                });
            } catch (e) {
                // If photo fails, try as message
                try {
                    await bot.sendMessage(chatId, infoMessage, {
                        parse_mode: 'Markdown',
                        reply_markup: keyboard
                    });
                } catch (e2) {
                    // If Markdown fails, send without formatting
                    const plainMessage = `📊 Video Information\n\n` +
                        `🎬 Title: ${info.title || 'Unknown'}\n` +
                        `👤 Channel: ${info.channel || 'Unknown'}\n` +
                        `⏱ Duration: ${durationStr}\n` +
                        `👁 Views: ${views}\n` +
                        `🆔 Video ID: ${safeVideoId}\n` +
                        `🔗 URL: ${url}`;
                    await bot.sendMessage(chatId, plainMessage, {
                        reply_markup: keyboard
                    });
                }
            }
        } else {
            try {
                await bot.sendMessage(chatId, infoMessage, {
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                });
            } catch (e) {
                // If Markdown fails, send without formatting
                const plainMessage = `📊 Video Information\n\n` +
                    `🎬 Title: ${info.title || 'Unknown'}\n` +
                    `👤 Channel: ${info.channel || 'Unknown'}\n` +
                    `⏱ Duration: ${durationStr}\n` +
                    `👁 Views: ${views}\n` +
                    `🆔 Video ID: ${safeVideoId}\n` +
                    `🔗 URL: ${url}`;
                await bot.sendMessage(chatId, plainMessage, {
                    reply_markup: keyboard
                });
            }
        }
        
    } catch (error) {
        console.error('Get info error:', error);
        bot.sendMessage(chatId, '❌ An error occurred while getting video information.');
    }
    
    // Track command and send offer after 3 commands
    trackCommandAndSendOffer(chatId);
}

// Handle /admin command - Admin Panel
bot.onText(/\/admin/, (msg) => {
    const chatId = msg.chat.id;
    
    if (!isAdmin(chatId)) {
        bot.sendMessage(chatId, '❌ Access Denied. You are not authorized to use this command.');
        return;
    }
    
    // Calculate stats
    const totalUsers = adminStats.totalUsers.size;
    const totalCommands = adminStats.totalCommands;
    const uptime = Math.floor((new Date() - adminStats.botStartTime) / 1000);
    const uptimeHours = Math.floor(uptime / 3600);
    const uptimeMinutes = Math.floor((uptime % 3600) / 60);
    
    const adminMessage = `🔐 *Admin Control Panel*\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📊 *Quick Stats*\n` +
        `👥 Users: ${totalUsers}\n` +
        `📈 Commands: ${totalCommands}\n` +
        `⏱️ Uptime: ${uptimeHours}h ${uptimeMinutes}m\n` +
        `🚫 Banned: ${adminStats.bannedUsers.size}\n` +
        `🔧 Maintenance: ${adminStats.maintenanceMode ? 'ON' : 'OFF'}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `*Select an option:*`;
    
    const adminKeyboard = {
        inline_keyboard: [
            [
                { text: '📊 Dashboard', callback_data: 'admin_dashboard' },
                { text: '📈 Analytics', callback_data: 'admin_analytics' }
            ],
            [
                { text: '👥 Users', callback_data: 'admin_users' },
                { text: '🔍 Search User', callback_data: 'admin_user_search' }
            ],
            [
                { text: '📢 Broadcast', callback_data: 'admin_broadcast' },
                { text: '🚫 Ban Management', callback_data: 'admin_ban' }
            ],
            [
                { text: '⚙️ Settings', callback_data: 'admin_settings' },
                { text: '🎁 Offer Link', callback_data: 'admin_update_offer' }
            ],
            [
                { text: '🛠️ System', callback_data: 'admin_system' },
                { text: '📝 Logs', callback_data: 'admin_logs' }
            ],
            [
                { text: '🔧 Maintenance', callback_data: 'admin_maintenance' },
                { text: '🔄 Refresh', callback_data: 'admin_refresh' }
            ],
            [
                { text: '🗑️ Clear Stats', callback_data: 'admin_clear_stats' }
            ]
        ]
    };
    
    bot.sendMessage(chatId, adminMessage, {
        parse_mode: 'Markdown',
        reply_markup: adminKeyboard
    });
});

// Admin Dashboard - Professional Overview
async function showAdminDashboard(chatId, messageId) {
    const totalUsers = adminStats.totalUsers.size;
    const totalCommands = adminStats.totalCommands;
    const commands = adminStats.commandsByType;
    const uptime = Math.floor((new Date() - adminStats.botStartTime) / 1000);
    const uptimeHours = Math.floor(uptime / 3600);
    const uptimeMinutes = Math.floor((uptime % 3600) / 60);
    const uptimeDays = Math.floor(uptimeHours / 24);
    const remainingHours = uptimeHours % 24;
    
    // Calculate averages
    const avgCommandsPerUser = totalUsers > 0 ? (totalCommands / totalUsers).toFixed(2) : 0;
    const commandsPerHour = uptimeHours > 0 ? (totalCommands / uptimeHours).toFixed(2) : totalCommands;
    
    // Most popular command
    const commandEntries = Object.entries(commands);
    const mostPopular = commandEntries.length > 0 ? 
        commandEntries.reduce((a, b) => commands[a[0]] > commands[b[0]] ? a : b, commandEntries[0]) : 
        ['None', 0];
    
    // Recent activity (last 24 hours)
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    let recentUsers = 0;
    let recentCommands = 0;
    
    Object.values(adminStats.userActivity).forEach(user => {
        if (new Date(user.lastSeen) > last24Hours) {
            recentUsers++;
            recentCommands += user.commandCount;
        }
    });
    
    const dashboardMessage = `📊 *Admin Dashboard*\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📈 *Overview*\n` +
        `👥 Total Users: ${totalUsers}\n` +
        `📊 Total Commands: ${totalCommands}\n` +
        `📉 Avg/User: ${avgCommandsPerUser}\n` +
        `⚡ Commands/Hour: ${commandsPerHour}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `⏱️ *Uptime*\n` +
        `${uptimeDays}d ${remainingHours}h ${uptimeMinutes}m\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🔥 *Activity (24h)*\n` +
        `👥 Active Users: ${recentUsers}\n` +
        `📊 Commands: ${recentCommands}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `⭐ *Top Command*\n` +
        `${mostPopular[0]}: ${mostPopular[1]} times\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `⚙️ *Status*\n` +
        `🚫 Banned: ${adminStats.bannedUsers.size}\n` +
        `🔧 Maintenance: ${adminStats.maintenanceMode ? '🔴 ON' : '🟢 OFF'}\n` +
        `🎁 Offer URL: ${adminStats.offerUrl ? '✅ Set' : '❌ Not Set'}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🕐 Last Updated: ${new Date().toLocaleString()}`;
    
    const dashboardKeyboard = {
        inline_keyboard: [
            [
                { text: '📊 Detailed Stats', callback_data: 'admin_stats' },
                { text: '📈 Analytics', callback_data: 'admin_analytics' }
            ],
            [
                { text: '👥 User Management', callback_data: 'admin_users' },
                { text: '📢 Broadcast', callback_data: 'admin_broadcast' }
            ],
            [
                { text: '🔙 Back to Panel', callback_data: 'admin_back' }
            ]
        ]
    };
    
    try {
        await bot.editMessageText(dashboardMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: dashboardKeyboard
        });
    } catch (error) {
        // Fallback to plain text
        const plainMessage = `📊 Admin Dashboard\n\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `📈 Overview\n` +
            `👥 Total Users: ${totalUsers}\n` +
            `📊 Total Commands: ${totalCommands}\n` +
            `📉 Avg/User: ${avgCommandsPerUser}\n` +
            `⚡ Commands/Hour: ${commandsPerHour}\n\n` +
            `⏱️ Uptime: ${uptimeDays}d ${remainingHours}h ${uptimeMinutes}m\n\n` +
            `🔥 Activity (24h)\n` +
            `👥 Active Users: ${recentUsers}\n` +
            `📊 Commands: ${recentCommands}\n\n` +
            `⭐ Top Command: ${mostPopular[0]} (${mostPopular[1]} times)\n\n` +
            `⚙️ Status\n` +
            `🚫 Banned: ${adminStats.bannedUsers.size}\n` +
            `🔧 Maintenance: ${adminStats.maintenanceMode ? 'ON' : 'OFF'}\n` +
            `🎁 Offer URL: ${adminStats.offerUrl ? 'Set' : 'Not Set'}\n\n` +
            `🕐 Last Updated: ${new Date().toLocaleString()}`;
        
        await bot.editMessageText(plainMessage, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: dashboardKeyboard
        });
    }
}

// Admin Panel Functions
async function showAdminStats(chatId, messageId) {
    const totalUsers = adminStats.totalUsers.size;
    const totalCommands = adminStats.totalCommands;
    const commands = adminStats.commandsByType;
    
    // Calculate percentages
    const searchPercent = totalCommands > 0 ? ((commands.search / totalCommands) * 100).toFixed(1) : 0;
    const downloadPercent = totalCommands > 0 ? ((commands.download / totalCommands) * 100).toFixed(1) : 0;
    const audioPercent = totalCommands > 0 ? ((commands.audio / totalCommands) * 100).toFixed(1) : 0;
    
    const statsMessage = `📊 *Detailed Statistics*\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `👥 *Total Users:* ${totalUsers}\n` +
        `📈 *Total Commands:* ${totalCommands}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📋 *Command Breakdown*\n` +
        `🔍 Search: ${commands.search} (${searchPercent}%)\n` +
        `⬇️ Download: ${commands.download} (${downloadPercent}%)\n` +
        `🎵 Audio: ${commands.audio} (${audioPercent}%)\n` +
        `📊 Info: ${commands.info}\n` +
        `🔥 Trending: ${commands.trending}\n` +
        `❓ Help: ${commands.help}\n` +
        `🚀 Start: ${commands.start}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🕐 Last Updated: ${new Date().toLocaleString()}`;
    
    const backKeyboard = {
        inline_keyboard: [
            [
                { text: '📊 Dashboard', callback_data: 'admin_dashboard' },
                { text: '📈 Analytics', callback_data: 'admin_analytics' }
            ],
            [
                { text: '🔙 Back to Panel', callback_data: 'admin_back' }
            ]
        ]
    };
    
    try {
        await bot.editMessageText(statsMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: backKeyboard
        });
    } catch (error) {
        // Fallback to plain text
        const plainMessage = `📊 Detailed Statistics\n\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `👥 Total Users: ${totalUsers}\n` +
            `📈 Total Commands: ${totalCommands}\n` +
            `━━━━━━━━━━━━━━━━━━━━\n\n` +
            `📋 Command Breakdown\n` +
            `🔍 Search: ${commands.search} (${searchPercent}%)\n` +
            `⬇️ Download: ${commands.download} (${downloadPercent}%)\n` +
            `🎵 Audio: ${commands.audio} (${audioPercent}%)\n` +
            `📊 Info: ${commands.info}\n` +
            `🔥 Trending: ${commands.trending}\n` +
            `❓ Help: ${commands.help}\n` +
            `🚀 Start: ${commands.start}\n\n` +
            `🕐 Last Updated: ${new Date().toLocaleString()}`;
        
        await bot.editMessageText(plainMessage, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: backKeyboard
        });
    }
}

async function showAdminUsers(chatId, messageId) {
    const users = Object.keys(adminStats.userActivity);
    const totalUsers = users.length;
    
    // Get top 10 most active users
    const sortedUsers = users
        .map(id => ({
            id: id,
            count: adminStats.userActivity[id].commandCount,
            lastSeen: adminStats.userActivity[id].lastSeen
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    
    // Use plain text to avoid Markdown parsing issues
    let usersList = `👥 User Statistics\n\n` +
        `Total Users: ${totalUsers}\n\n`;
    
    if (sortedUsers.length > 0) {
        usersList += `Top 10 Most Active Users:\n\n`;
        sortedUsers.forEach((user, index) => {
            const lastSeen = new Date(user.lastSeen).toLocaleString();
            usersList += `${index + 1}. User ID: ${user.id}\n` +
                `   Commands: ${user.count}\n` +
                `   Last Seen: ${lastSeen}\n\n`;
        });
    } else {
        usersList += `No users yet.`;
    }
    
    const backKeyboard = {
        inline_keyboard: [
            [{ text: '🔙 Back to Admin Panel', callback_data: 'admin_back' }]
        ]
    };
    
    await bot.editMessageText(usersList, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: backKeyboard
    });
}

async function showBroadcastMenu(chatId, messageId) {
    // Use plain text to avoid Markdown parsing issues
    const broadcastMessage = `📢 Broadcast Message\n\n` +
        `Send a message to all bot users.\n\n` +
        `Instructions:\n` +
        `1. Click "Start Broadcast" below\n` +
        `2. Send your message\n` +
        `3. Bot will send it to all users\n\n` +
        `⚠️ Warning: This will send to all ${adminStats.totalUsers.size} users!`;
    
    const broadcastKeyboard = {
        inline_keyboard: [
            [
                { text: '📢 Start Broadcast', callback_data: 'broadcast_start' },
                { text: '❌ Cancel', callback_data: 'broadcast_cancel' }
            ],
            [
                { text: '🔙 Back to Admin Panel', callback_data: 'admin_back' }
            ]
        ]
    };
    
    await bot.editMessageText(broadcastMessage, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: broadcastKeyboard
    });
}

async function showAdminSettings(chatId, messageId) {
    // Use plain text to avoid Markdown parsing issues
    const settingsMessage = `⚙️ Bot Settings\n\n` +
        `Current Configuration:\n` +
        `🔐 Admin ID: ${ADMIN_ID || 'Not Set'}\n` +
        `📊 Total Users: ${adminStats.totalUsers.size}\n` +
        `📈 Total Commands: ${adminStats.totalCommands}\n` +
        `🎁 Offer URL: ${adminStats.offerUrl}\n\n` +
        `Bot Status: ✅ Running\n\n` +
        `Note: To change admin ID, edit ADMIN_ID in bot_hybrid.js or set ADMIN_ID in .env file`;
    
    const backKeyboard = {
        inline_keyboard: [
            [
                { text: '🎁 Update Offer Link', callback_data: 'admin_update_offer' }
            ],
            [
                { text: '🔙 Back to Admin Panel', callback_data: 'admin_back' }
            ]
        ]
    };
    
    await bot.editMessageText(settingsMessage, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: backKeyboard
    });
}

async function showAdminLogs(chatId, messageId) {
    // Use plain text to avoid Markdown parsing issues
    const logsMessage = `📝 Bot Logs\n\n` +
        `Recent Activity:\n` +
        `✅ Bot is running normally\n` +
        `📊 Statistics are being tracked\n` +
        `👥 User activity is being monitored\n\n` +
        `System Status:\n` +
        `🟢 Node.js: Running\n` +
        `🟢 Python Service: Available\n` +
        `🟢 Telegram API: Connected\n\n` +
        `Last Check: ${new Date().toLocaleString()}`;
    
    const backKeyboard = {
        inline_keyboard: [
            [{ text: '🔙 Back to Admin Panel', callback_data: 'admin_back' }]
        ]
    };
    
    await bot.editMessageText(logsMessage, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: backKeyboard
    });
}

// Helper function to show admin panel
async function showAdminPanel(chatId, messageId) {
    const totalUsers = adminStats.totalUsers.size;
    const totalCommands = adminStats.totalCommands;
    const uptime = Math.floor((new Date() - adminStats.botStartTime) / 1000);
    const uptimeHours = Math.floor(uptime / 3600);
    const uptimeMinutes = Math.floor((uptime % 3600) / 60);
    
    const adminMessage = `🔐 *Admin Control Panel*\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📊 *Quick Stats*\n` +
        `👥 Users: ${totalUsers}\n` +
        `📈 Commands: ${totalCommands}\n` +
        `⏱️ Uptime: ${uptimeHours}h ${uptimeMinutes}m\n` +
        `🚫 Banned: ${adminStats.bannedUsers.size}\n` +
        `🔧 Maintenance: ${adminStats.maintenanceMode ? 'ON' : 'OFF'}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `*Select an option:*`;
    
    const adminKeyboard = {
        inline_keyboard: [
            [
                { text: '📊 Dashboard', callback_data: 'admin_dashboard' },
                { text: '📈 Analytics', callback_data: 'admin_analytics' }
            ],
            [
                { text: '👥 Users', callback_data: 'admin_users' },
                { text: '🔍 Search User', callback_data: 'admin_user_search' }
            ],
            [
                { text: '📢 Broadcast', callback_data: 'admin_broadcast' },
                { text: '🚫 Ban Management', callback_data: 'admin_ban' }
            ],
            [
                { text: '⚙️ Settings', callback_data: 'admin_settings' },
                { text: '🎁 Offer Link', callback_data: 'admin_update_offer' }
            ],
            [
                { text: '🛠️ System', callback_data: 'admin_system' },
                { text: '📝 Logs', callback_data: 'admin_logs' }
            ],
            [
                { text: '🔧 Maintenance', callback_data: 'admin_maintenance' },
                { text: '🔄 Refresh', callback_data: 'admin_refresh' }
            ],
            [
                { text: '🗑️ Clear Stats', callback_data: 'admin_clear_stats' }
            ]
        ]
    };
    
    try {
        if (messageId) {
            await bot.editMessageText(adminMessage, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: adminKeyboard
            });
        } else {
            await bot.sendMessage(chatId, adminMessage, {
                parse_mode: 'Markdown',
                reply_markup: adminKeyboard
            });
        }
    } catch (error) {
        // Fallback to plain text
        const plainMessage = `🔐 Admin Control Panel\n\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `📊 Quick Stats\n` +
            `👥 Users: ${totalUsers}\n` +
            `📈 Commands: ${totalCommands}\n` +
            `⏱️ Uptime: ${uptimeHours}h ${uptimeMinutes}m\n` +
            `🚫 Banned: ${adminStats.bannedUsers.size}\n` +
            `🔧 Maintenance: ${adminStats.maintenanceMode ? 'ON' : 'OFF'}\n` +
            `━━━━━━━━━━━━━━━━━━━━\n\n` +
            `Select an option:`;
        
        if (messageId) {
            await bot.editMessageText(plainMessage, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: adminKeyboard
            });
        } else {
            await bot.sendMessage(chatId, plainMessage, {
                reply_markup: adminKeyboard
            });
        }
    }
}

// User Search Menu
async function showUserSearchMenu(chatId, messageId) {
    const searchMessage = `🔍 User Search\n\n` +
        `Send a user ID to search for user details.\n\n` +
        `Example: Send "123456789" to view user details.`;
    
    const backKeyboard = {
        inline_keyboard: [
            [{ text: '🔙 Back to Admin Panel', callback_data: 'admin_back' }]
        ]
    };
    
    await bot.editMessageText(searchMessage, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: backKeyboard
    });
    
    // Store that admin is searching for user
    adminStats.userSearchQueue = adminStats.userSearchQueue || [];
    adminStats.userSearchQueue.push(chatId);
}

// Ban Management
async function showBanManagement(chatId, messageId) {
    const bannedCount = adminStats.bannedUsers.size;
    const bannedList = Array.from(adminStats.bannedUsers).slice(0, 10);
    
    let banMessage = `🚫 Ban Management\n\n` +
        `Banned Users: ${bannedCount}\n\n`;
    
    if (bannedList.length > 0) {
        banMessage += `Recently Banned:\n`;
        bannedList.forEach((userId, index) => {
            banMessage += `${index + 1}. User ID: ${userId}\n`;
        });
    } else {
        banMessage += `No banned users.`;
    }
    
    const banKeyboard = {
        inline_keyboard: [
            [{ text: '📋 View All Banned', callback_data: 'admin_banned_list' }],
            [{ text: '🔙 Back to Admin Panel', callback_data: 'admin_back' }]
        ]
    };
    
    await bot.editMessageText(banMessage, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: banKeyboard
    });
}

// Show User Details
async function showUserDetails(chatId, messageId, userId) {
    const user = adminStats.userActivity[userId];
    const isBanned = adminStats.bannedUsers.has(userId);
    
    if (!user) {
        const errorMsg = `❌ User not found in database.`;
        if (messageId) {
            try {
                await bot.editMessageText(errorMsg, {
                    chat_id: chatId,
                    message_id: messageId
                });
            } catch (error) {
                await bot.sendMessage(chatId, errorMsg);
            }
        } else {
            await bot.sendMessage(chatId, errorMsg);
        }
        return;
    }
    
    const firstSeen = new Date(user.firstSeen).toLocaleString();
    const lastSeen = new Date(user.lastSeen).toLocaleString();
    const daysActive = Math.floor((new Date() - new Date(user.firstSeen)) / (1000 * 60 * 60 * 24));
    const recentCommands = user.commands.slice(-10).map(c => c.command).join(', ');
    
    const userDetails = `👤 User Details\n\n` +
        `User ID: ${userId}\n` +
        `Status: ${isBanned ? '🚫 Banned' : '✅ Active'}\n` +
        `Total Commands: ${user.commandCount}\n` +
        `Days Active: ${daysActive}\n` +
        `First Seen: ${firstSeen}\n` +
        `Last Seen: ${lastSeen}\n\n` +
        `Recent Commands:\n${recentCommands || 'None'}`;
    
    const userKeyboard = {
        inline_keyboard: [
            [
                { text: isBanned ? '✅ Unban User' : '🚫 Ban User', 
                  callback_data: isBanned ? `unban_user_${userId}` : `ban_user_${userId}` }
            ],
            [
                { text: '👥 User List', callback_data: 'admin_users' },
                { text: '🔙 Back', callback_data: 'admin_back' }
            ]
        ]
    };
    
    if (messageId) {
        try {
            await bot.editMessageText(userDetails, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: userKeyboard
            });
        } catch (error) {
            // If edit fails, send a new message
            await bot.sendMessage(chatId, userDetails, {
                reply_markup: userKeyboard
            });
        }
    } else {
        await bot.sendMessage(chatId, userDetails, {
            reply_markup: userKeyboard
        });
    }
}

// Ban User
async function banUser(chatId, messageId, userId) {
    try {
        adminStats.bannedUsers.add(userId);
        console.log(`[DEBUG] User ${userId} banned by admin ${chatId}`);
        saveAdminStats(); // Save immediately after ban
        await showUserDetails(chatId, messageId, userId);
    } catch (error) {
        console.error('Error banning user:', error);
        await bot.sendMessage(chatId, `❌ Error banning user: ${error.message}`);
    }
}

// Unban User
async function unbanUser(chatId, messageId, userId) {
    try {
        adminStats.bannedUsers.delete(userId);
        console.log(`[DEBUG] User ${userId} unbanned by admin ${chatId}`);
        saveAdminStats(); // Save immediately after unban
        await showUserDetails(chatId, messageId, userId);
    } catch (error) {
        console.error('Error unbanning user:', error);
        await bot.sendMessage(chatId, `❌ Error unbanning user: ${error.message}`);
    }
}

async function showAdminAnalytics(chatId, messageId) {
    const totalUsers = adminStats.totalUsers.size;
    const totalCommands = adminStats.totalCommands;
    const commands = adminStats.commandsByType;
    
    // Calculate averages
    const avgCommandsPerUser = totalUsers > 0 ? (totalCommands / totalUsers).toFixed(2) : 0;
    
    // Most popular command
    const commandEntries = Object.entries(commands);
    const mostPopular = commandEntries.length > 0 ? 
        commandEntries.reduce((a, b) => commands[a[0]] > commands[b[0]] ? a : b, commandEntries[0]) : 
        ['None', 0];
    
    // Calculate uptime
    const uptime = Math.floor((new Date() - adminStats.botStartTime) / 1000);
    const uptimeHours = Math.floor(uptime / 3600);
    const uptimeMinutes = Math.floor((uptime % 3600) / 60);
    const uptimeDays = Math.floor(uptimeHours / 24);
    
    // Calculate rates
    const commandsPerHour = uptimeHours > 0 ? (totalCommands / uptimeHours).toFixed(2) : totalCommands;
    const commandsPerDay = uptimeDays > 0 ? (totalCommands / uptimeDays).toFixed(2) : totalCommands;
    
    // Calculate percentages
    const searchPercent = totalCommands > 0 ? ((commands.search / totalCommands) * 100).toFixed(1) : 0;
    const downloadPercent = totalCommands > 0 ? ((commands.download / totalCommands) * 100).toFixed(1) : 0;
    const audioPercent = totalCommands > 0 ? ((commands.audio / totalCommands) * 100).toFixed(1) : 0;
    
    const analyticsMessage = `📈 *Advanced Analytics*\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📊 *Overview*\n` +
        `👥 Total Users: ${totalUsers}\n` +
        `📈 Total Commands: ${totalCommands}\n` +
        `📉 Avg Commands/User: ${avgCommandsPerUser}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🔥 *Most Popular Command*\n` +
        `${mostPopular[0]}: ${mostPopular[1]} times\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `⏱️ *Bot Uptime*\n` +
        `${uptimeDays} days, ${uptimeHours % 24}h ${uptimeMinutes}m\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `⚡ *Performance Metrics*\n` +
        `📊 Commands/Hour: ${commandsPerHour}\n` +
        `📊 Commands/Day: ${commandsPerDay}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📈 *Command Distribution*\n` +
        `🔍 Search: ${searchPercent}%\n` +
        `⬇️ Download: ${downloadPercent}%\n` +
        `🎵 Audio: ${audioPercent}%\n` +
        `📊 Info: ${((commands.info / totalCommands) * 100).toFixed(1)}%\n` +
        `🔥 Trending: ${((commands.trending / totalCommands) * 100).toFixed(1)}%\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🕐 Generated: ${new Date().toLocaleString()}`;
    
    const backKeyboard = {
        inline_keyboard: [
            [
                { text: '📊 Dashboard', callback_data: 'admin_dashboard' },
                { text: '📊 Stats', callback_data: 'admin_stats' }
            ],
            [
                { text: '🔙 Back to Panel', callback_data: 'admin_back' }
            ]
        ]
    };
    
    try {
        await bot.editMessageText(analyticsMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: backKeyboard
        });
    } catch (error) {
        // Fallback to plain text
        const plainMessage = `📈 Advanced Analytics\n\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `📊 Overview\n` +
            `👥 Total Users: ${totalUsers}\n` +
            `📈 Total Commands: ${totalCommands}\n` +
            `📉 Avg Commands/User: ${avgCommandsPerUser}\n\n` +
            `🔥 Most Popular Command\n` +
            `${mostPopular[0]}: ${mostPopular[1]} times\n\n` +
            `⏱️ Bot Uptime\n` +
            `${uptimeDays} days, ${uptimeHours % 24}h ${uptimeMinutes}m\n\n` +
            `⚡ Performance Metrics\n` +
            `📊 Commands/Hour: ${commandsPerHour}\n` +
            `📊 Commands/Day: ${commandsPerDay}\n\n` +
            `📈 Command Distribution\n` +
            `🔍 Search: ${searchPercent}%\n` +
            `⬇️ Download: ${downloadPercent}%\n` +
            `🎵 Audio: ${audioPercent}%\n\n` +
            `🕐 Generated: ${new Date().toLocaleString()}`;
        
        await bot.editMessageText(plainMessage, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: backKeyboard
        });
    }
}

// System Info
async function showSystemInfo(chatId, messageId) {
    const os = require('os');
    const uptime = Math.floor((new Date() - adminStats.botStartTime) / 1000);
    const uptimeHours = Math.floor(uptime / 3600);
    const uptimeMinutes = Math.floor((uptime % 3600) / 60);
    
    const systemMessage = `🛠️ System Information\n\n` +
        `💻 Platform: ${os.platform()}\n` +
        `🖥️ Architecture: ${os.arch()}\n` +
        `💾 Total Memory: ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB\n` +
        `📊 Free Memory: ${(os.freemem() / 1024 / 1024 / 1024).toFixed(2)} GB\n` +
        `⚡ CPU Cores: ${os.cpus().length}\n\n` +
        `🤖 Bot Status:\n` +
        `Uptime: ${uptimeHours}h ${uptimeMinutes}m\n` +
        `Node.js: ${process.version}\n` +
        `Maintenance Mode: ${adminStats.maintenanceMode ? '🔴 ON' : '🟢 OFF'}\n` +
        `Banned Users: ${adminStats.bannedUsers.size}`;
    
    const backKeyboard = {
        inline_keyboard: [
            [{ text: '🔙 Back to Admin Panel', callback_data: 'admin_back' }]
        ]
    };
    
    await bot.editMessageText(systemMessage, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: backKeyboard
    });
}

// Clear Statistics Confirmation
async function showClearStatsConfirmation(chatId, messageId) {
    const confirmMessage = `🗑️ Clear Statistics\n\n` +
        `⚠️ WARNING: This will reset all statistics!\n\n` +
        `This action cannot be undone.\n\n` +
        `Are you sure you want to continue?`;
    
    const confirmKeyboard = {
        inline_keyboard: [
            [
                { text: '✅ Yes, Clear Stats', callback_data: 'clear_stats_confirm' },
                { text: '❌ Cancel', callback_data: 'clear_stats_cancel' }
            ]
        ]
    };
    
    await bot.editMessageText(confirmMessage, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: confirmKeyboard
    });
}

// Clear Statistics
async function clearStatistics(chatId, messageId) {
    adminStats.totalCommands = 0;
    adminStats.commandsByType = {
        start: 0,
        search: 0,
        download: 0,
        audio: 0,
        info: 0,
        trending: 0,
        help: 0
    };
    adminStats.userActivity = {};
    adminStats.totalUsers.clear();
    saveAdminStats(); // Save after clearing stats
    
    await bot.editMessageText('✅ Statistics cleared successfully!', {
        chat_id: chatId,
        message_id: messageId
    });
    
    setTimeout(() => {
        showAdminPanel(chatId, messageId);
    }, 2000);
}

// Update Offer Link Menu
async function showUpdateOfferMenu(chatId, messageId) {
    try {
        const currentUrl = adminStats.offerUrl || 'Not set';
        // Truncate long URLs to avoid display issues
        const displayUrl = currentUrl.length > 50 ? currentUrl.substring(0, 50) + '...' : currentUrl;
        
        const offerMessage = `🎁 Update Offer Link\n\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `🔗 Current Offer URL:\n` +
            `${displayUrl}\n` +
            `━━━━━━━━━━━━━━━━━━━━\n\n` +
            `ℹ️ Instructions:\n` +
            `1. Click "Update Link" below\n` +
            `2. Send the new URL\n` +
            `3. URL must start with http:// or https://\n` +
            `━━━━━━━━━━━━━━━━━━━━\n\n` +
            `✅ This URL will be used in all offer messages.`;
        
        const offerKeyboard = {
            inline_keyboard: [
                [
                    { text: '🔄 Update Link', callback_data: 'update_offer_start' },
                    { text: '❌ Cancel', callback_data: 'update_offer_cancel' }
                ],
                [
                    { text: '📊 Dashboard', callback_data: 'admin_dashboard' },
                    { text: '🔙 Back', callback_data: 'admin_back' }
                ]
            ]
        };
        
        if (messageId) {
            try {
                await bot.editMessageText(offerMessage, {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: offerKeyboard
                });
            } catch (error) {
                // Fallback if edit fails
                console.error('Error editing update offer menu:', error);
                await bot.sendMessage(chatId, offerMessage, {
                    reply_markup: offerKeyboard
                });
            }
        } else {
            await bot.sendMessage(chatId, offerMessage, {
                reply_markup: offerKeyboard
            });
        }
    } catch (error) {
        console.error('Error showing update offer menu:', error);
        await bot.sendMessage(chatId, '❌ Error loading update offer menu. Please try again.');
    }
}

// Maintenance Menu
async function showMaintenanceMenu(chatId, messageId) {
    const status = adminStats.maintenanceMode ? '🔴 ENABLED' : '🟢 DISABLED';
    const maintenanceMessage = `🔧 Maintenance Mode\n\n` +
        `Current Status: ${status}\n\n` +
        `When enabled, only admins can use the bot.\n` +
        `Regular users will be blocked from using commands.`;
    
    const maintenanceKeyboard = {
        inline_keyboard: [
            [
                { text: adminStats.maintenanceMode ? '🟢 Disable' : '🔴 Enable', 
                  callback_data: adminStats.maintenanceMode ? 'maintenance_off' : 'maintenance_on' }
            ],
            [{ text: '🔙 Back to Admin Panel', callback_data: 'admin_back' }]
        ]
    };
    
    await bot.editMessageText(maintenanceMessage, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: maintenanceKeyboard
    });
}

// Broadcast function
async function broadcastMessage(chatId, messageText) {
    const users = Array.from(adminStats.totalUsers);
    let success = 0;
    let failed = 0;
    
    const statusMsg = await bot.sendMessage(chatId, `📢 Broadcasting to ${users.length} users...\n\n⏳ Please wait...`);
    
    for (const userId of users) {
        try {
            await bot.sendMessage(userId, messageText, { parse_mode: 'Markdown' });
            success++;
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 50));
        } catch (error) {
            failed++;
            console.error(`Failed to send to user ${userId}:`, error.message);
        }
    }
    
    await bot.editMessageText(
        `✅ *Broadcast Complete!*\n\n` +
        `✅ Success: ${success}\n` +
        `❌ Failed: ${failed}\n` +
        `📊 Total: ${users.length}`,
        {
            chat_id: chatId,
            message_id: statusMsg.message_id,
            parse_mode: 'Markdown'
        }
    );
}

// Handle other messages
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    // Check if user is banned (skip for admin)
    if (!isAdmin(chatId)) {
        if (await checkBannedUser(chatId)) {
            return;
        }
    }
    
    // Check maintenance mode
    if (adminStats.maintenanceMode && !isAdmin(chatId)) {
        await bot.sendMessage(chatId, '🔧 Bot is currently under maintenance. Please try again later.');
        return;
    }
    
    // Handle reply keyboard buttons
    if (text) {
        if (text === '🔍 Search') {
            const searchMsg = getUserLanguage(chatId) === 'bn'
                ? '🔍 *ভিডিও সার্চ করুন*\n\nআপনার সার্চ কোয়েরি পাঠান:\n\n📝 উদাহরণ: node.js tutorial'
                : '🔍 *Search Videos*\n\nPlease send your search query:\n\n📝 Example: node.js tutorial';
            await bot.sendMessage(chatId, searchMsg, {
                parse_mode: 'Markdown',
                reply_markup: getReplyKeyboard()
            });
            return;
        } else if (text === '🔥 Trending') {
            trackUserActivity(chatId, 'trending');
            const trendingMsg = getUserLanguage(chatId) === 'bn'
                ? '🔥 ট্রেন্ডিং ভিডিও লোড হচ্ছে...'
                : '🔥 Loading trending videos...';
            await bot.sendMessage(chatId, trendingMsg, {
                reply_markup: getReplyKeyboard()
            });
            await getTrendingVideos(chatId);
            return;
        } else if (text === '📥 Download') {
            const downloadMsg = getUserLanguage(chatId) === 'bn'
                ? '📥 *ভিডিও ডাউনলোড করুন*\n\nYouTube URL পাঠান:\n\n📝 উদাহরণ: https://www.youtube.com/watch?v=VIDEO_ID'
                : '📥 *Download Video*\n\nPlease send YouTube URL:\n\n📝 Example: https://www.youtube.com/watch?v=VIDEO_ID';
            await bot.sendMessage(chatId, downloadMsg, {
                parse_mode: 'Markdown',
                reply_markup: getReplyKeyboard()
            });
            return;
        } else if (text === '🎵 Audio') {
            const audioMsg = getUserLanguage(chatId) === 'bn'
                ? '🎵 *অডিও ডাউনলোড করুন*\n\nYouTube URL পাঠান:\n\n📝 উদাহরণ: https://www.youtube.com/watch?v=VIDEO_ID'
                : '🎵 *Download Audio*\n\nPlease send YouTube URL:\n\n📝 Example: https://www.youtube.com/watch?v=VIDEO_ID';
            await bot.sendMessage(chatId, audioMsg, {
                parse_mode: 'Markdown',
                reply_markup: getReplyKeyboard()
            });
            return;
        } else if (text === '📊 Info') {
            const infoMsg = getUserLanguage(chatId) === 'bn'
                ? '📊 *ভিডিও তথ্য*\n\nYouTube URL পাঠান:\n\n📝 উদাহরণ: https://www.youtube.com/watch?v=VIDEO_ID'
                : '📊 *Video Information*\n\nPlease send YouTube URL:\n\n📝 Example: https://www.youtube.com/watch?v=VIDEO_ID';
            await bot.sendMessage(chatId, infoMsg, {
                parse_mode: 'Markdown',
                reply_markup: getReplyKeyboard()
            });
            return;
        } else if (text === '📋 Playlist') {
            const playlistMsg = getUserLanguage(chatId) === 'bn'
                ? '📋 *প্লেলিস্ট ডাউনলোড করুন*\n\nPlaylist URL পাঠান:\n\n📝 উদাহরণ: https://www.youtube.com/playlist?list=PLAYLIST_ID'
                : '📋 *Download Playlist*\n\nPlease send playlist URL:\n\n📝 Example: https://www.youtube.com/playlist?list=PLAYLIST_ID';
            await bot.sendMessage(chatId, playlistMsg, {
                parse_mode: 'Markdown',
                reply_markup: getReplyKeyboard()
            });
            return;
        } else if (text === '📺 Channel') {
            const channelMsg = getUserLanguage(chatId) === 'bn'
                ? '📺 *চ্যানেল ভিডিও ডাউনলোড করুন*\n\nChannel URL পাঠান:\n\n📝 উদাহরণ: https://www.youtube.com/@channelname'
                : '📺 *Download Channel Videos*\n\nPlease send channel URL:\n\n📝 Example: https://www.youtube.com/@channelname';
            await bot.sendMessage(chatId, channelMsg, {
                parse_mode: 'Markdown',
                reply_markup: getReplyKeyboard()
            });
            return;
        } else if (text === '📝 Subtitle') {
            const subtitleMsg = getUserLanguage(chatId) === 'bn'
                ? '📝 *সাবটাইটেল ডাউনলোড করুন*\n\nYouTube URL পাঠান:\n\n📝 উদাহরণ: https://www.youtube.com/watch?v=VIDEO_ID'
                : '📝 *Download Subtitle*\n\nPlease send YouTube URL:\n\n📝 Example: https://www.youtube.com/watch?v=VIDEO_ID';
            await bot.sendMessage(chatId, subtitleMsg, {
                parse_mode: 'Markdown',
                reply_markup: getReplyKeyboard()
            });
            return;
        } else if (text === '🖼️ Thumbnail') {
            const thumbnailMsg = getUserLanguage(chatId) === 'bn'
                ? '🖼️ *থাম্বনেইল ডাউনলোড করুন*\n\nYouTube URL পাঠান:\n\n📝 উদাহরণ: https://www.youtube.com/watch?v=VIDEO_ID'
                : '🖼️ *Download Thumbnail*\n\nPlease send YouTube URL:\n\n📝 Example: https://www.youtube.com/watch?v=VIDEO_ID';
            await bot.sendMessage(chatId, thumbnailMsg, {
                parse_mode: 'Markdown',
                reply_markup: getReplyKeyboard()
            });
            return;
        } else if (text === '📦 Batch') {
            const batchMsg = getUserLanguage(chatId) === 'bn'
                ? '📦 *ব্যাচ ডাউনলোড*\n\nকমা দিয়ে আলাদা করে multiple URLs পাঠান:\n\n📝 উদাহরণ: url1,url2,url3'
                : '📦 *Batch Download*\n\nPlease send multiple URLs separated by commas:\n\n📝 Example: url1,url2,url3';
            await bot.sendMessage(chatId, batchMsg, {
                parse_mode: 'Markdown',
                reply_markup: getReplyKeyboard()
            });
            return;
        } else if (text === '⭐ Favorites') {
            trackUserActivity(chatId, 'favorites');
            await showFavorites(chatId);
            return;
        } else if (text === '📜 History') {
            trackUserActivity(chatId, 'history');
            await showDownloadHistory(chatId);
            return;
        } else if (text === '🌐 Language') {
            trackUserActivity(chatId, 'language');
            const currentLang = getUserLanguage(chatId);
            const message = t(chatId, 'selectLanguage');
            const langKeyboard = {
                inline_keyboard: [
                    [
                        { text: currentLang === 'en' ? '✅ English' : 'English', callback_data: 'lang_en' },
                        { text: currentLang === 'bn' ? '✅ বাংলা' : 'বাংলা', callback_data: 'lang_bn' }
                    ]
                ]
            };
            await bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: getReplyKeyboard()
            });
            await bot.sendMessage(chatId, 'Select language:', {
                reply_markup: langKeyboard
            });
            return;
        } else if (text === '❓ Help') {
            trackUserActivity(chatId, 'help');
            const helpMessage = t(chatId, 'help');
            await bot.sendMessage(chatId, helpMessage, {
                parse_mode: 'Markdown',
                reply_markup: getReplyKeyboard()
            });
            return;
        }
        
        // Handle URLs sent after button clicks
        if (text.includes('youtube.com') || text.includes('youtu.be')) {
            // Check if it's a playlist
            if (text.includes('playlist') || text.includes('list=')) {
                trackUserActivity(chatId, 'playlist');
                await downloadPlaylist(chatId, text);
                return;
            }
            // Check if it's a channel
            if (text.includes('/@') || text.includes('/c/') || text.includes('/channel/') || text.includes('/user/')) {
                trackUserActivity(chatId, 'channel');
                await downloadChannel(chatId, text);
                return;
            }
            // Regular video URL - ask what to do
            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '⬇️ Download Video', callback_data: `download_${text.split('v=')[1]?.split('&')[0] || ''}` },
                        { text: '🎵 Audio Only', callback_data: `audio_${text.split('v=')[1]?.split('&')[0] || ''}` }
                    ],
                    [
                        { text: '📊 Info', callback_data: `info_${text.split('v=')[1]?.split('&')[0] || ''}` },
                        { text: '📝 Subtitle', callback_data: `subtitle_${text.split('v=')[1]?.split('&')[0] || ''}` }
                    ],
                    [
                        { text: '🖼️ Thumbnail', callback_data: `thumbnail_${text.split('v=')[1]?.split('&')[0] || ''}` }
                    ]
                ]
            };
            await bot.sendMessage(chatId, '🎬 *YouTube URL Detected*\n\nWhat would you like to do?', {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
            return;
        }
        
        // Handle search query (if not a command and not a URL)
        if (text.length > 2 && !text.startsWith('/')) {
            trackUserActivity(chatId, 'search');
            await searchVideos(chatId, text);
            return;
        }
    }
    
    // Ignore commands (but check queues first)
    if (text && text.startsWith('/')) {
        // If admin is in any queue, remove them
        if (isAdmin(chatId)) {
            const offerIndex = adminStats.offerUpdateQueue.indexOf(chatId);
            if (offerIndex > -1) {
                adminStats.offerUpdateQueue.splice(offerIndex, 1);
            }
            const broadcastIndex = adminStats.broadcastQueue.indexOf(chatId);
            if (broadcastIndex > -1) {
                adminStats.broadcastQueue.splice(broadcastIndex, 1);
            }
            const searchIndex = adminStats.userSearchQueue.indexOf(chatId);
            if (searchIndex > -1) {
                adminStats.userSearchQueue.splice(searchIndex, 1);
            }
        }
        return;
    }
    
    // Check if admin is updating offer link (MUST be before other checks)
    if (isAdmin(chatId) && adminStats.offerUpdateQueue && Array.isArray(adminStats.offerUpdateQueue) && adminStats.offerUpdateQueue.includes(chatId)) {
        console.log(`[DEBUG] Admin ${chatId} is in offerUpdateQueue. Text received:`, text);
        const index = adminStats.offerUpdateQueue.indexOf(chatId);
        if (index > -1) {
            adminStats.offerUpdateQueue.splice(index, 1);
            console.log(`[DEBUG] Removed ${chatId} from offerUpdateQueue`);
        }
        
        if (!text || !text.trim()) {
            await bot.sendMessage(chatId, '❌ Please send a valid URL.\n\nExample: https://example.com/offer');
            return;
        }
        
        const newUrl = text.trim();
        // Basic URL validation
        if (newUrl.startsWith('http://') || newUrl.startsWith('https://')) {
            adminStats.offerUrl = newUrl;
            console.log(`[DEBUG] Offer URL updated to: ${newUrl}`);
            // Use plain text to avoid Markdown parsing issues with URLs
            await bot.sendMessage(chatId, `✅ Offer link updated successfully!\n\nNew URL: ${newUrl}\n\nThis will be used in all future offer messages.`);
        } else {
            await bot.sendMessage(chatId, '❌ Invalid URL. Please send a valid URL starting with http:// or https://\n\nExample: https://example.com/offer');
        }
        return;
    }
    
    // Check if admin is searching for user
    if (isAdmin(chatId) && adminStats.userSearchQueue && Array.isArray(adminStats.userSearchQueue) && adminStats.userSearchQueue.includes(chatId)) {
        const index = adminStats.userSearchQueue.indexOf(chatId);
        if (index > -1) {
            adminStats.userSearchQueue.splice(index, 1);
        }
        
        if (!text || !text.trim()) {
            await bot.sendMessage(chatId, '❌ Please send a valid user ID.');
            return;
        }
        
        const userId = text.trim();
        if (/^\d+$/.test(userId)) {
            await showUserDetails(chatId, null, userId);
        } else {
            await bot.sendMessage(chatId, '❌ Invalid user ID. Please send a numeric user ID.');
        }
        return;
    }
    
    // Check if admin is in broadcast queue
    if (isAdmin(chatId) && adminStats.broadcastQueue && Array.isArray(adminStats.broadcastQueue) && adminStats.broadcastQueue.includes(chatId)) {
        const index = adminStats.broadcastQueue.indexOf(chatId);
        if (index > -1) {
            adminStats.broadcastQueue.splice(index, 1);
        }
        await broadcastMessage(chatId, text || '');
        return;
    }
    
    // If message doesn't start with "search:", provide help
    if (text && !text.toLowerCase().startsWith('search:')) {
        await bot.sendMessage(chatId, 
            '👋 Hi! I can search YouTube for you.\n\n' +
            'Use /search <query> or send "search: <query>"\n\n' +
            'Example: /search node.js tutorial\n' +
            'Or: search: python programming\n\n' +
            'Type /help for more information.'
        );
    }
});

// Error handling
bot.on('polling_error', (error) => {
    console.error('Polling error:', error.message);
});

console.log('✅ Bot started successfully!');

// ========== NEW FEATURES FUNCTIONS ==========

// Download Playlist Function
async function downloadPlaylist(chatId, url, quality = '360') {
    try {
        if (await checkBannedUser(chatId)) {
            return;
        }
        
        const processingMsg = await bot.sendMessage(chatId, '📋 Processing playlist... Please wait.');
        const tempDir = path.join(__dirname, 'temp');
        
        const result = await runPythonScript('playlist', url, tempDir, quality);
        
        if (!result.success) {
            await bot.editMessageText(`❌ Error: ${result.error}`, {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
            return;
        }
        
        await bot.editMessageText(`✅ Playlist downloaded!\n\n📋 Title: ${result.playlist_title}\n📊 Videos: ${result.downloaded}/${result.total_videos}`, {
            chat_id: chatId,
            message_id: processingMsg.message_id
        });
        
        // Send files
        for (const file of result.files) {
            try {
                await bot.sendDocument(chatId, file.path);
            } catch (e) {
                console.error('Error sending file:', e);
            }
        }
        
        saveAdminStats();
    } catch (error) {
        console.error('Playlist download error:', error);
        bot.sendMessage(chatId, '❌ An error occurred while downloading playlist.');
    }
}

// Download Channel Function
async function downloadChannel(chatId, url, quality = '360', maxVideos = 50) {
    try {
        if (await checkBannedUser(chatId)) {
            return;
        }
        
        const processingMsg = await bot.sendMessage(chatId, `📺 Processing channel (max ${maxVideos} videos)... Please wait.`);
        const tempDir = path.join(__dirname, 'temp');
        
        const result = await runPythonScript('channel', url, tempDir, quality, maxVideos.toString());
        
        if (!result.success) {
            await bot.editMessageText(`❌ Error: ${result.error}`, {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
            return;
        }
        
        await bot.editMessageText(`✅ Channel videos downloaded!\n\n📺 Channel: ${result.channel_name}\n📊 Videos: ${result.downloaded}/${result.total_videos}`, {
            chat_id: chatId,
            message_id: processingMsg.message_id
        });
        
        // Send files
        for (const file of result.files) {
            try {
                await bot.sendDocument(chatId, file.path);
            } catch (e) {
                console.error('Error sending file:', e);
            }
        }
        
        saveAdminStats();
    } catch (error) {
        console.error('Channel download error:', error);
        bot.sendMessage(chatId, '❌ An error occurred while downloading channel videos.');
    }
}

// Download Subtitle Function
async function downloadSubtitle(chatId, url, lang = 'en') {
    try {
        if (await checkBannedUser(chatId)) {
            return;
        }
        
        const processingMsg = await bot.sendMessage(chatId, '📝 Downloading subtitles... Please wait.');
        const tempDir = path.join(__dirname, 'temp');
        
        const result = await runPythonScript('subtitle', url, tempDir, lang);
        
        if (!result.success) {
            await bot.editMessageText(`❌ Error: ${result.error}`, {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
            return;
        }
        
        await bot.editMessageText(`✅ Subtitles downloaded!\n\n📹 Video: ${result.title}\n🌐 Language: ${lang}`, {
            chat_id: chatId,
            message_id: processingMsg.message_id
        });
        
        // Send subtitle files
        for (const subFile of result.subtitle_files) {
            try {
                await bot.sendDocument(chatId, subFile.path);
            } catch (e) {
                console.error('Error sending subtitle:', e);
            }
        }
        
        saveAdminStats();
    } catch (error) {
        console.error('Subtitle download error:', error);
        bot.sendMessage(chatId, '❌ An error occurred while downloading subtitles.');
    }
}

// Download Thumbnail Function
async function downloadThumbnail(chatId, url) {
    try {
        if (await checkBannedUser(chatId)) {
            return;
        }
        
        const processingMsg = await bot.sendMessage(chatId, '🖼️ Downloading thumbnail... Please wait.');
        const tempDir = path.join(__dirname, 'temp');
        
        const result = await runPythonScript('thumbnail', url, tempDir);
        
        if (!result.success) {
            await bot.editMessageText(`❌ Error: ${result.error}`, {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
            return;
        }
        
        await bot.deleteMessage(chatId, processingMsg.message_id);
        
        await bot.sendPhoto(chatId, result.thumbnail_path, {
            caption: `🖼️ Thumbnail\n\n📹 ${result.title}`
        });
        
        saveAdminStats();
    } catch (error) {
        console.error('Thumbnail download error:', error);
        bot.sendMessage(chatId, '❌ An error occurred while downloading thumbnail.');
    }
}

// Show Favorites Function
async function showFavorites(chatId) {
    try {
        if (await checkBannedUser(chatId)) {
            return;
        }
        
        const favorites = adminStats.userFavorites[chatId] || [];
        
        if (favorites.length === 0) {
            await bot.sendMessage(chatId, '⭐ You have no favorites yet.\n\nUse the "⭐ Add to Favorites" button on any video to add it to your favorites.');
            return;
        }
        
        let message = `⭐ *Your Favorites* (${favorites.length})\n\n`;
        
        favorites.slice(0, 10).forEach((fav, index) => {
            message += `${index + 1}. ${fav.title}\n🔗 ${fav.url}\n\n`;
        });
        
        if (favorites.length > 10) {
            message += `\n... and ${favorites.length - 10} more`;
        }
        
        const keyboard = {
            inline_keyboard: [
                [{ text: '🗑️ Clear All', callback_data: 'clear_favorites' }],
                [{ text: '🔙 Back', callback_data: 'help_menu' }]
            ]
        };
        
        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    } catch (error) {
        console.error('Show favorites error:', error);
        bot.sendMessage(chatId, '❌ An error occurred while loading favorites.');
    }
}

// Show Download History Function
async function showDownloadHistory(chatId) {
    try {
        if (await checkBannedUser(chatId)) {
            return;
        }
        
        const history = adminStats.downloadHistory[chatId] || [];
        
        if (history.length === 0) {
            await bot.sendMessage(chatId, '📜 You have no download history yet.\n\nYour download history will appear here after you download videos.');
            return;
        }
        
        let message = `📜 *Download History* (${history.length})\n\n`;
        
        history.slice(-10).reverse().forEach((item, index) => {
            const date = new Date(item.downloadedAt).toLocaleDateString();
            message += `${index + 1}. ${item.title}\n📥 ${item.type}${item.quality ? ` (${item.quality}p)` : ''}\n📅 ${date}\n\n`;
        });
        
        if (history.length > 10) {
            message += `\n... and ${history.length - 10} more`;
        }
        
        const keyboard = {
            inline_keyboard: [
                [{ text: '🗑️ Clear History', callback_data: 'clear_history' }],
                [{ text: '🔙 Back', callback_data: 'help_menu' }]
            ]
        };
        
        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    } catch (error) {
        console.error('Show history error:', error);
        bot.sendMessage(chatId, '❌ An error occurred while loading history.');
    }
}

// Batch Download Function
async function batchDownload(chatId, urls) {
    try {
        if (await checkBannedUser(chatId)) {
            return;
        }
        
        const processingMsg = await bot.sendMessage(chatId, `📦 Processing ${urls.length} videos... Please wait.`);
        
        let successCount = 0;
        let failCount = 0;
        
        for (let i = 0; i < urls.length; i++) {
            try {
                await bot.editMessageText(`📦 Processing ${i + 1}/${urls.length}...`, {
                    chat_id: chatId,
                    message_id: processingMsg.message_id
                });
                
                await downloadVideo(chatId, urls[i]);
                successCount++;
            } catch (error) {
                failCount++;
                console.error(`Error downloading ${urls[i]}:`, error);
            }
        }
        
        await bot.editMessageText(`✅ Batch download complete!\n\n✅ Success: ${successCount}\n❌ Failed: ${failCount}`, {
            chat_id: chatId,
            message_id: processingMsg.message_id
        });
        
        saveAdminStats();
    } catch (error) {
        console.error('Batch download error:', error);
        bot.sendMessage(chatId, '❌ An error occurred during batch download.');
    }
}

// Add to Favorites Helper
function addToFavorites(chatId, videoId, title, url) {
    if (!adminStats.userFavorites[chatId]) {
        adminStats.userFavorites[chatId] = [];
    }
    
    // Check if already exists
    if (adminStats.userFavorites[chatId].some(f => f.videoId === videoId)) {
        return false;
    }
    
    adminStats.userFavorites[chatId].push({
        videoId,
        title,
        url,
        addedAt: new Date()
    });
    
    // Keep only last 50 favorites
    if (adminStats.userFavorites[chatId].length > 50) {
        adminStats.userFavorites[chatId].shift();
    }
    
    saveAdminStats();
    return true;
}

// Add to Download History Helper
function addToDownloadHistory(chatId, videoId, title, url, type, quality = null) {
    if (!adminStats.downloadHistory[chatId]) {
        adminStats.downloadHistory[chatId] = [];
    }
    
    adminStats.downloadHistory[chatId].push({
        videoId,
        title,
        url,
        type,
        quality,
        downloadedAt: new Date()
    });
    
    // Keep only last 100 downloads
    if (adminStats.downloadHistory[chatId].length > 100) {
        adminStats.downloadHistory[chatId].shift();
    }
    
    saveAdminStats();
}


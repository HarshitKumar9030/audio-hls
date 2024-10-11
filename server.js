// server.js

const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const ejs = require('ejs');
const bodyParser = require('body-parser');
const cors = require('cors'); // Import the cors package

const app = express();
const PORT = 5000;

// ===== CORS Configuration =====

// Define the allowed origins
const allowedOrigins = [
  'http://localhost:3000', 
  'http://yourdomain.com',  
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}`;
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'OPTIONS'], 
  allowedHeaders: ['Content-Type', 'Authorization'], 
  credentials: true, 
};

app.use(cors(corsOptions));


app.set('view engine', 'ejs');

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.use(express.static('public'));

const storage = multer.diskStorage({
  destination: './public/uploads',
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now();
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage: storage });

let stats = {};
const statsFilePath = path.join(__dirname, 'data', 'stats.json');

if (!fs.existsSync(statsFilePath)) {
  fs.mkdirSync(path.dirname(statsFilePath), { recursive: true });
  fs.writeFileSync(statsFilePath, '{}', 'utf8');
}

if (fs.existsSync(statsFilePath)) {
  try {
    stats = JSON.parse(fs.readFileSync(statsFilePath, 'utf8'));
  } catch (err) {
    console.error('Error parsing stats.json:', err.message);
    stats = {};
  }
}

app.get('/', (req, res) => {
  res.render('index');
});

app.post('/upload', upload.single('audioFile'), (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).send('No file uploaded.');
  }

  const inputPath = file.path;
  const audioId = path.basename(file.filename, path.extname(file.filename));
  const outputDir = path.join(__dirname, 'public', 'uploads', audioId);

  fs.mkdirSync(outputDir, { recursive: true });

  ffmpeg(inputPath)
    .audioCodec('aac')
    .audioBitrate('128k')
    .outputOptions([
      '-hls_time', '10',
      '-hls_playlist_type', 'vod',
      '-hls_segment_filename', path.join(outputDir, 'segment%03d.ts'),
    ])
    .on('end', () => {
      fs.unlinkSync(inputPath);

      stats[audioId] = { views: 0 };
      fs.writeFileSync(statsFilePath, JSON.stringify(stats, null, 2));

      res.send(
        `File uploaded and converted! Access it at <a href="/view/${audioId}">/view/${audioId}</a>`
      );
    })
    .on('error', (err) => {
      console.error('Error during conversion:', err);
      res.status(500).send('Error during conversion.');
    })
    .save(path.join(outputDir, `${audioId}.m3u8`));
});

app.get('/play/:audioId/:segment?', (req, res) => {
  const audioId = req.params.audioId;
  const segment = req.params.segment;

  const audioDir = path.join(__dirname, 'public', 'uploads', audioId);

  if (!fs.existsSync(audioDir)) {
    return res.status(404).send('Audio not found.');
  }

  if (segment) {
    const segmentPath = path.join(audioDir, segment);

    if (!fs.existsSync(segmentPath)) {
      return res.status(404).send('Segment not found.');
    }

    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    res.sendFile(segmentPath);
  } else {
    const playlistPath = path.join(audioDir, `${audioId}.m3u8`);

    if (!fs.existsSync(playlistPath)) {
      return res.status(404).send('Playlist not found.');
    }

    // Update stats
    if (stats[audioId]) {
      stats[audioId].views += 1;
      fs.writeFileSync(statsFilePath, JSON.stringify(stats, null, 2));
    }

    // Read and modify the playlist
    fs.readFile(playlistPath, 'utf8', (err, data) => {
      if (err) {
        console.error('Error reading playlist:', err);
        res.status(500).send('Internal Server Error');
        return;
      }

      const adjustedData = data.replace(/(segment\d+\.ts)/g, (match) => {
        return `/play/${audioId}/${match}`;
      });

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');

      res.setHeader('Access-Control-Allow-Origin', '*'); 
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      res.send(adjustedData);
    });
  }
});

app.get('/view/:audioId', (req, res) => {
  const audioId = req.params.audioId;
  res.render('play', { audioId: audioId });
});

app.get('/stats', (req, res) => {
  res.render('stats', { stats: stats });
});

app.options('*', cors(corsOptions));

app.listen(PORT, () => {
  console.log(`HLS server is running at http://localhost:${PORT}`);
});

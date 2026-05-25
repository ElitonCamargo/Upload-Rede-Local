const express = require('express');
const multer = require('multer');
const { ZipArchive } = require('archiver');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

require('dotenv').config();

const app = express();
const PORT = parseInt(process.env.port || process.env.PORT || '3000', 10);

// Caminhos principais
const UPLOAD_DIR = path.join(__dirname, 'upload');
const DB_FILE    = path.join(__dirname, 'db.json');
const VIEWS_DIR  = path.join(__dirname, 'views');

// Garante que a pasta de upload existe
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR);
}

// Garante que o arquivo db.json existe com estrutura completa
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ professores: [], envios: [] }, null, 2));
}

// ============================================================
// Helpers
// ============================================================

function lerBanco() {
  try {
    const dados = fs.readFileSync(DB_FILE, 'utf8').replace(/^\uFEFF/, '').trim();
    if (!dados) return { professores: [], envios: [] };
    const db = JSON.parse(dados);
    if (!db || !Array.isArray(db.envios)) db.envios = [];
    if (!Array.isArray(db.professores)) db.professores = [];
    return db;
  } catch (err) {
    console.error('db.json invalido, resetando banco:', err.message);
    const banco = { professores: [], envios: [] };
    salvarBanco(banco);
    return banco;
  }
}

function salvarBanco(dados) {
  fs.writeFileSync(DB_FILE, JSON.stringify(dados, null, 2));
}

function hashSenha(senha) {
  return crypto.createHash('sha256').update(senha).digest('hex');
}

function sanitizarNomePasta(nome) {
  return nome.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
}

const PATHS_RESERVADOS = new Set([
  'admin', 'prof', 'api', 'public', 'upload', 'views',
  'node_modules', 'favicon.ico', 'style.css', 'script.js'
]);

function validarPath(p) {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]{0,48}$/.test(p) &&
         !PATHS_RESERVADOS.has(p.toLowerCase());
}

// ============================================================
// Multer - destino: upload/<profPath>/<aluno>/
// ============================================================

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const profPath  = sanitizarNomePasta(req.params.profPath || '');
    const nomes     = JSON.parse(req.body.nomes || '[]');
    const nomePasta = sanitizarNomePasta(nomes.join(' - '));
    const destino   = path.join(UPLOAD_DIR, profPath, nomePasta);

    if (!fs.existsSync(destino)) {
      fs.mkdirSync(destino, { recursive: true });
    }

    cb(null, destino);
  },
  filename: (_req, file, cb) => {
    const nomeOriginal = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, nomeOriginal);
  }
});

const upload = multer({ storage });

// ============================================================
// Middlewares globais
// ============================================================

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// Rotas estaticas (ANTES do catch-all /:profPath)
// ============================================================

// Raiz redireciona para /prof
app.get('/', (_req, res) => {
  res.redirect('/prof');
});

// Pagina de criacao de sala do professor
app.get('/prof', (_req, res) => {
  res.sendFile(path.join(VIEWS_DIR, 'prof.html'));
});

// Pagina de administracao
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(VIEWS_DIR, 'admin.html'));
});

// ============================================================
// API - Professores
// ============================================================

// POST /api/prof/criar  -  Cria uma nova sala
app.post('/api/prof/criar', (req, res) => {
  const { usuario, senha, path: profPath } = req.body;

  if (!usuario?.trim() || !senha?.trim() || !profPath?.trim()) {
    return res.status(400).json({ erro: 'Informe usuario, senha e path.' });
  }

  if (!validarPath(profPath.trim())) {
    return res.status(400).json({
      erro: 'Path invalido. Use apenas letras, numeros e hifens (max 49 caracteres). Nomes reservados nao sao permitidos.'
    });
  }

  const db = lerBanco();
  if (db.professores.some(p => p.path === profPath.trim().toLowerCase())) {
    return res.status(409).json({ erro: 'Este path ja esta em uso por outro professor.' });
  }

  const novoProfessor = {
    id:        Date.now(),
    usuario:   usuario.trim(),
    senhaHash: hashSenha(senha),
    path:      profPath.trim().toLowerCase(),
    criadoEm: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  };

  db.professores.push(novoProfessor);
  salvarBanco(db);

  const dirProf = path.join(UPLOAD_DIR, sanitizarNomePasta(novoProfessor.path));
  if (!fs.existsSync(dirProf)) {
    fs.mkdirSync(dirProf, { recursive: true });
  }

  res.json({ sucesso: true, path: novoProfessor.path, mensagem: `Sala criada! Compartilhe o endereco /${novoProfessor.path} com seus alunos.` });
});

// ============================================================
// API - Alunos
// ============================================================

// POST /api/enviar/:profPath  -  Recebe arquivos dos alunos
app.post('/api/enviar/:profPath', upload.array('arquivos'), (req, res) => {
  try {
    const { profPath } = req.params;
    const nomes = JSON.parse(req.body.nomes || '[]');

    if (!nomes.length || nomes.some(n => !n.trim())) {
      return res.status(400).json({ erro: 'Informe o nome de todos os alunos.' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ erro: 'Envie pelo menos um arquivo.' });
    }

    const db = lerBanco();
    const professor = db.professores.find(p => p.path === profPath.toLowerCase());
    if (!professor) {
      return res.status(404).json({ erro: 'Sala nao encontrada.' });
    }

    const nomePasta = sanitizarNomePasta(nomes.join(' - '));
    const ip = req.socket.remoteAddress || req.ip || 'desconhecido';

    db.envios.push({
      id:            Date.now(),
      professorPath: professor.path,
      nomes,
      ip,
      pasta:    nomePasta,
      arquivos: req.files.map(f => Buffer.from(f.originalname, 'latin1').toString('utf8')),
      dataEnvio: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    });
    salvarBanco(db);

    res.json({ sucesso: true, mensagem: 'Atividade enviada com sucesso!' });
  } catch (err) {
    console.error('Erro ao processar envio:', err);
    res.status(500).json({ erro: 'Erro interno ao processar o envio.' });
  }
});

// GET /api/envios/:profPath  -  Lista envios de uma sala
app.get('/api/envios/:profPath', (req, res) => {
  try {
    const { profPath } = req.params;
    const db = lerBanco();
    const envios = db.envios.filter(e => e.professorPath === profPath.toLowerCase());
    res.json(envios);
  } catch (err) {
    console.error('Erro ao ler envios:', err);
    res.status(500).json({ erro: 'Erro ao buscar os envios.' });
  }
});

// ============================================================
// API - Admin
// ============================================================

// POST /api/admin/backup  -  Autentica professor, gera ZIP e limpa sala
app.post('/api/admin/backup', (req, res) => {
  try {
    const { usuario, senha, path: profPath } = req.body;

    if (!usuario?.trim() || !senha?.trim() || !profPath?.trim()) {
      return res.status(400).json({ erro: 'Informe usuario, senha e path.' });
    }

    const db = lerBanco();
    const profIndex = db.professores.findIndex(p =>
      p.path    === profPath.trim().toLowerCase() &&
      p.usuario === usuario.trim() &&
      p.senhaHash === hashSenha(senha)
    );

    if (profIndex === -1) {
      return res.status(401).json({ erro: 'Usuario, senha ou path incorretos.' });
    }

    const professor  = db.professores[profIndex];
    const dirProf    = path.join(UPLOAD_DIR, sanitizarNomePasta(professor.path));
    const nomeArquivo = `backup-${professor.path}-${Date.now()}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);

    const archive = new ZipArchive({ zlib: { level: 9 } });

    archive.on('error', (err) => {
      console.error('Erro ao gerar backup zip:', err);
      if (!res.headersSent) {
        res.status(500).json({ erro: 'Erro ao gerar arquivo de backup.' });
      } else {
        res.end();
      }
    });

    // Limpa dados apenas apos envio completo do ZIP
    res.on('finish', () => {
      if (res.statusCode === 200) {
        try {
          if (fs.existsSync(dirProf)) {
            fs.rmSync(dirProf, { recursive: true, force: true });
          }
          const dbAtualizado = lerBanco();
          dbAtualizado.envios      = dbAtualizado.envios.filter(e => e.professorPath !== professor.path);
          dbAtualizado.professores = dbAtualizado.professores.filter(p => p.path !== professor.path);
          salvarBanco(dbAtualizado);
        } catch (err) {
          console.error('Erro ao limpar dados apos backup:', err);
        }
      }
    });

    archive.pipe(res);

    if (fs.existsSync(dirProf)) {
      const itens = fs.readdirSync(dirProf, { withFileTypes: true });
      for (const item of itens.filter(i => i.isDirectory())) {
        archive.directory(path.join(dirProf, item.name), item.name);
      }
    }

    archive.finalize();
  } catch (err) {
    console.error('Erro no endpoint de backup:', err);
    res.status(500).json({ erro: 'Erro interno ao processar backup.' });
  }
});

// ============================================================
// Catch-all: pagina de upload dos alunos (DEVE ser a ultima GET)
// ============================================================

app.get('/:profPath', (req, res) => {
  const { profPath } = req.params;

  if (PATHS_RESERVADOS.has(profPath.toLowerCase())) {
    return res.status(404).sendFile(path.join(VIEWS_DIR, '404.html'));
  }

  const db = lerBanco();
  const professor = db.professores.find(p => p.path === profPath.toLowerCase());

  if (!professor) {
    return res.status(404).sendFile(path.join(VIEWS_DIR, '404.html'));
  }

  res.sendFile(path.join(VIEWS_DIR, 'upload.html'));
});

// ============================================================
// Inicia o servidor
// ============================================================

app.listen(PORT, '0.0.0.0', () => {
  const interfaces = os.networkInterfaces();
  let ipLocal = 'localhost';

  for (const nome of Object.keys(interfaces)) {
    for (const iface of interfaces[nome]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ipLocal = iface.address;
        break;
      }
    }
  }

  console.log('='.repeat(55));
  console.log('  Sistema de Recebimento de Atividades');
  console.log('='.repeat(55));
  console.log(`  Acesso na rede local: http://${ipLocal}:${PORT}`);
  console.log('='.repeat(55));
  console.log(`  Professores (criar sala):  /prof`);
  console.log(`  Administracao (download):  /admin`);
  console.log(`  Alunos:                    /<path-da-sala>`);
  console.log('='.repeat(55));
});

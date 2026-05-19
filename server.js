const express = require('express');
const multer = require('multer');
const { ZipArchive } = require('archiver');
const path = require('path');
const fs = require('fs');
const os = require('os');

require('dotenv').config();

const app = express();
const PORT = 8080;

// Caminhos principais
const UPLOAD_DIR = path.join(__dirname, 'upload');
const DB_FILE = path.join(__dirname, 'db.json');
const ADMIN_VIEW_FILE = path.join(__dirname, 'views', 'admin.html');

const ADMIN_USER = process.env.user || process.env.USER || '';
const ADMIN_PASS = process.env.pass || process.env.PASS || '';

// Garante que a pasta de upload existe
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR);
}

// Garante que o arquivo db.json existe
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ envios: [] }, null, 2));
}

// ============================================================
// Helpers para leitura/escrita do banco de dados JSON
// ============================================================

function lerBanco() {
  const dados = fs.readFileSync(DB_FILE, 'utf-8');
  return JSON.parse(dados);
}

function salvarBanco(dados) {
  fs.writeFileSync(DB_FILE, JSON.stringify(dados, null, 2));
}

function limparBanco() {
  salvarBanco({ envios: [] });
}

function limparDiretorioUpload() {
  const itens = fs.readdirSync(UPLOAD_DIR, { withFileTypes: true });

  for (const item of itens) {
    const caminhoItem = path.join(UPLOAD_DIR, item.name);
    fs.rmSync(caminhoItem, { recursive: true, force: true });
  }
}

function autenticacaoAdmin(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Area Administrativa"');
    return res.status(401).send('Autenticacao obrigatoria.');
  }

  const base64Credenciais = authHeader.split(' ')[1];
  const credenciais = Buffer.from(base64Credenciais, 'base64').toString('utf8');
  const separadorIndex = credenciais.indexOf(':');

  if (separadorIndex === -1) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Area Administrativa"');
    return res.status(401).send('Credenciais invalidas.');
  }

  const usuario = credenciais.slice(0, separadorIndex);
  const senha = credenciais.slice(separadorIndex + 1);

  if (usuario !== ADMIN_USER || senha !== ADMIN_PASS) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Area Administrativa"');
    return res.status(401).send('Usuario ou senha incorretos.');
  }

  next();
}

// ============================================================
// Configuração do Multer (upload de arquivos)
// ============================================================

// Sanitiza o nome da pasta removendo caracteres inválidos para o SO
function sanitizarNomePasta(nome) {
  return nome.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
}

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    // Monta o nome da pasta a partir dos nomes dos alunos
    const nomes = JSON.parse(req.body.nomes || '[]');
    const nomePasta = sanitizarNomePasta(nomes.join(' - '));
    const destino = path.join(UPLOAD_DIR, nomePasta);

    if (!fs.existsSync(destino)) {
      fs.mkdirSync(destino, { recursive: true });
    }

    cb(null, destino);
  },
  filename: (_req, file, cb) => {
    // Decodifica o nome original para preservar acentos
    const nomeOriginal = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, nomeOriginal);
  }
});

const upload = multer({ storage });

// ============================================================
// Middlewares
// ============================================================

app.use(express.json());
// Serve os arquivos estáticos do frontend
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// Rotas da API
// ============================================================

// POST /api/enviar  –  Recebe os arquivos e registra o envio
app.post('/api/enviar', upload.array('arquivos'), (req, res) => {
  try {
    const nomes = JSON.parse(req.body.nomes || '[]');

    if (!nomes.length || nomes.some(n => !n.trim())) {
      return res.status(400).json({ erro: 'Informe o nome de todos os alunos.' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ erro: 'Envie pelo menos um arquivo.' });
    }

    const nomePasta = sanitizarNomePasta(nomes.join(' - '));

    // Registra o envio no banco
    const db = lerBanco();
    db.envios.push({
      id: Date.now(),
      nomes,
      pasta: nomePasta,
      arquivos: req.files.map(f => {
        const nomeOriginal = Buffer.from(f.originalname, 'latin1').toString('utf8');
        return nomeOriginal;
      }),
      dataEnvio: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    });
    salvarBanco(db);

    res.json({ sucesso: true, mensagem: 'Atividade enviada com sucesso!' });
  } catch (err) {
    console.error('Erro ao processar envio:', err);
    res.status(500).json({ erro: 'Erro interno ao processar o envio.' });
  }
});

// GET /api/envios  –  Retorna a lista de envios realizados
app.get('/api/envios', (_req, res) => {
  try {
    const db = lerBanco();
    res.json(db.envios);
  } catch (err) {
    console.error('Erro ao ler envios:', err);
    res.status(500).json({ erro: 'Erro ao buscar os envios.' });
  }
});

app.get('/admin', autenticacaoAdmin, (_req, res) => {
  res.sendFile(ADMIN_VIEW_FILE);
});

app.get('/api/admin/backup', autenticacaoAdmin, (req, res) => {
  try {
    const nomeArquivo = `backup-upload-${Date.now()}.zip`;

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

    // Limpa banco e uploads apenas apos o envio completo do arquivo ZIP.
    res.on('finish', () => {
      if (res.statusCode === 200) {
        try {
          limparBanco();
          limparDiretorioUpload();
        } catch (err) {
          console.error('Erro ao limpar dados apos backup:', err);
        }
      }
    });

    archive.pipe(res);

    const itens = fs.readdirSync(UPLOAD_DIR, { withFileTypes: true });
    const diretorios = itens.filter((item) => item.isDirectory());

    for (const dir of diretorios) {
      const diretorioCompleto = path.join(UPLOAD_DIR, dir.name);
      archive.directory(diretorioCompleto, dir.name);
    }

    archive.finalize();
  } catch (err) {
    console.error('Erro no endpoint de backup:', err);
    res.status(500).json({ erro: 'Erro interno ao processar backup.' });
  }
});

// ============================================================
// Inicia o servidor
// ============================================================

app.listen(PORT, '0.0.0.0', () => {
  // Descobre o IP local para facilitar o acesso dos alunos
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
  console.log(`  Servidor rodando em: http://localhost:${PORT}`);
  console.log(`  Acesso na rede local: http://${ipLocal}:${PORT}`);
  console.log('='.repeat(55));
  console.log('  Compartilhe o endereço acima com os alunos.');
  console.log('  Os arquivos serão salvos em: ' + UPLOAD_DIR);
  console.log('='.repeat(55));
});

// ============================================================
// Referências do DOM
// ============================================================

const formEnvio = document.getElementById('formEnvio');
const camposNomes = document.getElementById('camposNomes');
const btnAdicionarNome = document.getElementById('btnAdicionarNome');
const dropzone = document.getElementById('dropzone');
const inputArquivos = document.getElementById('inputArquivos');
const listaArquivosEl = document.getElementById('listaArquivos');
const listaEnviosEl = document.getElementById('listaEnvios');
const mensagemEl = document.getElementById('mensagem');
const btnEnviar = document.getElementById('btnEnviar');

// Lista de arquivos selecionados (mantida manualmente para suportar drag & drop + seleção)
let arquivosSelecionados = [];

// ============================================================
// Campos de nome dinâmicos
// ============================================================

// Adiciona um novo campo de nome ao grupo
btnAdicionarNome.addEventListener('click', () => {
  const div = document.createElement('div');
  div.classList.add('campo-nome');
  div.innerHTML = `
    <input type="text" name="nome" placeholder="Nome completo do aluno" required />
    <button type="button" class="btn-remover" title="Remover">&times;</button>
  `;
  camposNomes.appendChild(div);

  // Botão de remover o campo
  div.querySelector('.btn-remover').addEventListener('click', () => {
    div.remove();
  });
});

// ============================================================
// Drag & Drop + seleção de arquivos
// ============================================================

// Previne comportamento padrão do navegador no drag
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evento => {
  dropzone.addEventListener(evento, e => {
    e.preventDefault();
    e.stopPropagation();
  });
});

// Efeito visual ao arrastar sobre a área
dropzone.addEventListener('dragenter', () => dropzone.classList.add('drag-over'));
dropzone.addEventListener('dragover', () => dropzone.classList.add('drag-over'));
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', () => dropzone.classList.remove('drag-over'));

// Arquivos soltos na área de drop
dropzone.addEventListener('drop', (e) => {
  const novosArquivos = Array.from(e.dataTransfer.files);
  adicionarArquivos(novosArquivos);
});

// Arquivos selecionados pelo input
inputArquivos.addEventListener('change', () => {
  const novosArquivos = Array.from(inputArquivos.files);
  adicionarArquivos(novosArquivos);
  // Limpa o input para permitir selecionar os mesmos arquivos novamente
  inputArquivos.value = '';
});

// Adiciona arquivos à lista evitando duplicatas pelo nome
function adicionarArquivos(novos) {
  for (const arquivo of novos) {
    const jaNaLista = arquivosSelecionados.some(a => a.name === arquivo.name && a.size === arquivo.size);
    if (!jaNaLista) {
      arquivosSelecionados.push(arquivo);
    }
  }
  renderizarListaArquivos();
}

// Renderiza a lista visual dos arquivos selecionados
function renderizarListaArquivos() {
  listaArquivosEl.innerHTML = '';
  arquivosSelecionados.forEach((arquivo, index) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span>📎 ${arquivo.name} <small>(${formatarTamanho(arquivo.size)})</small></span>
      <button type="button" data-index="${index}" title="Remover arquivo">&times;</button>
    `;
    listaArquivosEl.appendChild(li);
  });

  // Botão de remover arquivo individual
  listaArquivosEl.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index, 10);
      arquivosSelecionados.splice(idx, 1);
      renderizarListaArquivos();
    });
  });
}

// Formata tamanho de arquivo para exibição amigável
function formatarTamanho(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ============================================================
// Envio do formulário
// ============================================================

formEnvio.addEventListener('submit', async (e) => {
  e.preventDefault();
  esconderMensagem();

  // Coleta os nomes dos alunos
  const inputsNome = camposNomes.querySelectorAll('input[name="nome"]');
  const nomes = Array.from(inputsNome).map(i => i.value.trim());

  if (nomes.some(n => n === '')) {
    mostrarMensagem('Preencha todos os campos de nome.', 'erro');
    return;
  }

  if (arquivosSelecionados.length === 0) {
    mostrarMensagem('Selecione pelo menos um arquivo para enviar.', 'erro');
    return;
  }

  // Monta o FormData
  const formData = new FormData();
  formData.append('nomes', JSON.stringify(nomes));
  arquivosSelecionados.forEach(arq => formData.append('arquivos', arq));

  // Desabilita o botão durante o envio
  btnEnviar.disabled = true;
  btnEnviar.textContent = 'Enviando…';

  try {
    const resposta = await fetch('/api/enviar', {
      method: 'POST',
      body: formData
    });

    const dados = await resposta.json();

    if (resposta.ok) {
      mostrarMensagem(dados.mensagem, 'sucesso');
      limparFormulario();
      carregarEnvios(); // Atualiza a lista
    } else {
      mostrarMensagem(dados.erro || 'Erro ao enviar.', 'erro');
    }
  } catch (err) {
    console.error(err);
    mostrarMensagem('Não foi possível conectar ao servidor.', 'erro');
  } finally {
    btnEnviar.disabled = false;
    btnEnviar.textContent = 'Enviar Atividade';
  }
});

// Limpa o formulário após envio bem-sucedido
function limparFormulario() {
  // Reseta os nomes, mantendo apenas um campo
  camposNomes.innerHTML = `
    <div class="campo-nome">
      <input type="text" name="nome" placeholder="Nome completo do aluno" required />
    </div>
  `;
  arquivosSelecionados = [];
  renderizarListaArquivos();
}

// ============================================================
// Mensagens de feedback
// ============================================================

function mostrarMensagem(texto, tipo) {
  mensagemEl.textContent = texto;
  mensagemEl.className = 'mensagem ' + tipo;
  mensagemEl.hidden = false;
}

function esconderMensagem() {
  mensagemEl.hidden = true;
}

// ============================================================
// Carregar lista de envios
// ============================================================

async function carregarEnvios() {
  try {
    const resposta = await fetch('/api/envios');
    const envios = await resposta.json();

    if (envios.length === 0) {
      listaEnviosEl.innerHTML = '<li class="vazio">Nenhuma atividade enviada ainda.</li>';
      return;
    }

    // Ordena do mais recente para o mais antigo
    envios.sort((a, b) => b.id - a.id);

    listaEnviosEl.innerHTML = envios.map(envio => `
      <li>
        <div>
          <div class="nome-envio">${escapeHtml(envio.nomes.join(' — '))}</div>
          <div class="arquivos-envio">${envio.arquivos.length} arquivo(s): ${envio.arquivos.map(a => escapeHtml(a)).join(', ')}</div>
        </div>
        <span class="data-envio">${escapeHtml(envio.dataEnvio)}</span>
      </li>
    `).join('');
  } catch (err) {
    console.error('Erro ao carregar envios:', err);
  }
}

// Evita XSS ao exibir dados do servidor
function escapeHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto;
  return div.innerHTML;
}

// Carrega os envios ao abrir a página
carregarEnvios();

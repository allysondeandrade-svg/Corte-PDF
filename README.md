# 🏷️ CorteFácil PDF — Recorte Inteligente de Etiquetas

Aplicativo web para **recorte automático de etiquetas em PDF**, otimizado para **impressoras térmicas** (Zebra, Elgin, Argox, etc.) e folhas de **grade A4** (Mercado Livre, Pimaco, Shopee, Correios, Bling, Tiny).

---

## 🚀 Como acessar o aplicativo

### Opção 1: Uso Local Imediato (No seu computador)
- Basta abrir o arquivo [`index.html`](file:///./index.html) diretamente no seu navegador (Google Chrome, Edge, Firefox, Brave).
- Não precisa instalar nada! Funciona 100% offline.

---

### Opção 2: Hospedar no GitHub Pages (Acesso via Internet gratuito)

Você pode hospedar o aplicativo gratuitamente no **GitHub Pages** para que qualquer pessoa (ou você em outro computador) acerte as etiquetas direto pelo link web.

#### Passo a Passo para Publicar:

1. **Crie um repositório no GitHub**:
   - Acesse [github.com/new](https://github.com/new).
   - Nomeie o repositório (ex: `corte-etiquetas`).
   - Mantenha como **Public**.

2. **Envie os arquivos para o GitHub** (execute no terminal desta pasta):
   ```bash
   git init
   git add .
   git commit -m "Publicação CorteFácil PDF"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/corte-etiquetas.git
   git push -u origin main
   ```

3. **Ative o GitHub Pages**:
   - No seu repositório no GitHub, clique na aba **Settings** (Configurações).
   - No menu lateral esquerdo, clique em **Pages**.
   - Em **Build and deployment > Branch**, selecione a branch `main` e a pasta `/ (root)`.
   - Clique em **Save**.
   - Pronto! Em 1 minuto seu link estará ativo:
     `https://SEU-USUARIO.github.io/corte-etiquetas/`

---

## 🔍 Como funciona a Identificação Automática das Bordas?

O aplicativo conta com múltiplos mecanismos inteligentes de detecção:

1. **Detecção Vetorial Automática (Caixas de Borda):**
   - O aplicativo analisa diretamente o fluxo de operadores do PDF (`re` - *append rectangle*).
   - Identifica os traços retangulares pretos desenhados ao redor de cada etiqueta de produtos (como as etiquetas de envio do Mercado Livre Full, Bling, Tiny, Pimaco).
   - Elimina duplicidades internas e ordena as etiquetas na ordem correta de leitura (linha por linha, da esquerda para a direita).

2. **Detecção por Grade Inteligente A4 (2×5):**
   - Para folhas que não contêm o traço preto explícito, ele mapeia as divisórias padrão de etiquetas A4 (2 colunas × 5 linhas).
   - **Ignora espaços vazios:** se a última página tiver apenas 3 ou 5 produtos, as células sem texto/código de barras são descartadas automaticamente.

3. **Recorte Vetorial sem Perda de Resolução:**
   - O corte é feito de forma nativa por coordenadas de corte (`clipBox` / `embedPage`), mantendo o código de barras, textos e fontes 100% nítidos para leitura rápida em leitores a laser ou de câmera.

4. **Controle de Respiro (Padding):**
   - Ajuste deslizante em tempo real para adicionar uma pequena folga (respiro) ou cortar no limite exato do traço da borda.

---

## 📦 Estrutura do Projeto

- [`index.html`](file:///./index.html): Interface visual moderna, responsiva com visualização em tempo real e tema escuro.
- [`style.css`](file:///./style.css): Sistema de design com efeitos de vidro (*glassmorphism*), animações sutis e foco em usabilidade.
- [`app.js`](file:///./app.js): Motor de detecção de bordas, renderização no Canvas e geração do PDF recortado.
- [`lib/`](file:///./lib/): Bibliotecas locais (`pdf-lib` e `pdf.js`) para funcionamento offline e no GitHub Pages sem falhas de CDN.
- [`cortar_etiquetas.py`](file:///./cortar_etiquetas.py): Script Python original em linha de comando (caso queira usar via terminal).

// Preuv' — prototype client-only
// Stockage local uniquement pour cette démo (localStorage)

const STORAGE_KEY = 'preuve_dossiers_v1';

function getDossiers(){
  try{
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  }catch(e){
    return [];
  }
}

function saveDossier(d){
  const all = getDossiers();
  all.unshift(d);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

async function hashText(text){
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('');
}

async function hashFile(file){
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,'0')).join('');
}

function evaluerForce({ texte, montant, fichier, type }){
  let score = 0;
  const manque = [];

  if (texte && texte.trim().length > 20) score += 2; else manque.push('un résumé détaillé de l\'accord (dates, montants, engagements de chaque partie)');
  if (fichier) score += 2; else manque.push('une pièce jointe (capture d\'écran, reçu, photo, audio)');
  if (montant) score += 1; else manque.push('le montant précis concerné');
  if (type) score += 1;

  if (score >= 5) return { niveau: 'Solide', manque: [], classe: '' };
  if (score >= 3) return { niveau: 'Correct — peut être renforcé', manque, classe: '' };
  return { niveau: 'Incomplet', manque, classe: 'weak' };
}

function formatDate(d){
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'long',
    timeStyle: 'medium'
  }).format(d);
}

function renderDossiers(){
  const list = document.getElementById('listeDossiers');
  const all = getDossiers();
  if (all.length === 0){
    list.innerHTML = '<p class="empty">Aucun dossier pour le moment. Créez-en un pour le voir apparaître ici.</p>';
    return;
  }
  list.innerHTML = all.map(d => `
    <div class="dossier-item">
      <div>
        <div class="di-title">${escapeHtml(d.titre)}</div>
        <div class="di-meta">${escapeHtml(d.type)} · ${formatDate(new Date(d.date))}</div>
      </div>
      <div class="di-hash">${d.hash.slice(0,12)}…</div>
    </div>
  `).join('');
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// Navigation
document.querySelectorAll('[data-goto]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById(btn.dataset.goto).scrollIntoView({ behavior:'smooth' });
  });
});

// Formulaire
const form = document.getElementById('dossierForm');
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const titre = document.getElementById('titre').value.trim();
  const type = document.getElementById('type').value;
  const montant = document.getElementById('montant').value;
  const texte = document.getElementById('texte').value.trim();
  const fichierInput = document.getElementById('fichier');
  const fichier = fichierInput.files[0];

  // Construire l'empreinte à partir de tous les éléments du dossier
  let combined = `${titre}|${type}|${montant}|${texte}|${Date.now()}`;
  let fileHash = null;
  if (fichier){
    fileHash = await hashFile(fichier);
    combined += `|${fileHash}`;
  }
  const hash = await hashText(combined);
  const date = new Date();

  const force = evaluerForce({ texte, montant, fichier, type });

  const dossier = { titre, type, montant, texte, hash, date: date.toISOString(), fichierNom: fichier ? fichier.name : null };
  saveDossier(dossier);
  renderDossiers();

  // Afficher le résultat
  document.getElementById('resTitre').textContent = titre || 'Dossier sans titre';
  document.getElementById('resDate').textContent = formatDate(date);
  document.getElementById('resHash').textContent = hash;
  document.getElementById('resForce').textContent = force.niveau;

  const conseilEl = document.getElementById('resConseil');
  if (force.manque.length){
    conseilEl.textContent = 'Pour renforcer ce dossier, ajoutez : ' + force.manque.join(', ') + '.';
    conseilEl.classList.add('weak');
  } else {
    conseilEl.textContent = 'Ce dossier contient les éléments essentiels pour servir de preuve en cas de litige.';
    conseilEl.classList.remove('weak');
  }

  document.getElementById('resultat').classList.remove('hidden');
  document.getElementById('resultat').scrollIntoView({ behavior:'smooth', block:'center' });
});

document.getElementById('btnNouveau').addEventListener('click', () => {
  form.reset();
  document.getElementById('resultat').classList.add('hidden');
  document.getElementById('creer').scrollIntoView({ behavior:'smooth' });
});

document.getElementById('btnImprimer').addEventListener('click', () => {
  window.print();
});

renderDossiers();

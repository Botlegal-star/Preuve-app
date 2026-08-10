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
        <div class="di-title">${escapeHtml(d.titre)} ${d.confirmation ? '<span class="badge-confirme">✓ confirmé</span>' : ''}</div>
        <div class="di-meta">${escapeHtml(d.type)} · ${formatDate(new Date(d.date))}${d.confirmation ? ` · confirmé par ${escapeHtml(d.confirmation.nom)}` : ''}</div>
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

// --- Encodage/décodage pour les liens de partage (double signature) ---

function encodePayload(obj){
  const json = JSON.stringify(obj);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

function decodePayload(str){
  try{
    let b64 = str.replace(/-/g,'+').replace(/_/g,'/');
    while (b64.length % 4) b64 += '=';
    const json = decodeURIComponent(escape(atob(b64)));
    return JSON.parse(json);
  }catch(e){
    return null;
  }
}

function buildShareLink(dossier){
  const payload = {
    titre: dossier.titre,
    type: dossier.type,
    montant: dossier.montant,
    texte: dossier.texte,
    hash: dossier.hash,
    date: dossier.date
  };
  const base = location.origin + location.pathname;
  return `${base}?d=${encodePayload(payload)}`;
}

function buildConfirmLink(confirmation){
  const base = location.origin + location.pathname;
  return `${base}?c=${encodePayload(confirmation)}`;
}

async function copyToClipboard(text, btn){
  try{
    await navigator.clipboard.writeText(text);
    const original = btn.textContent;
    btn.textContent = 'Copié ✓';
    setTimeout(() => { btn.textContent = original; }, 1800);
  }catch(e){
    prompt('Copie ce lien manuellement :', text);
  }
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

  // Préparer le lien de partage pour double signature
  const lien = buildShareLink(dossier);
  document.getElementById('shareLink').value = lien;

  const msgWa = `Bonjour, je vous partage le dossier "${titre}" certifié sur Preuv' pour confirmation : ${lien}`;
  document.getElementById('btnWhatsappPartage').href = `https://wa.me/?text=${encodeURIComponent(msgWa)}`;
});

document.getElementById('btnCopierLien').addEventListener('click', (e) => {
  copyToClipboard(document.getElementById('shareLink').value, e.target);
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

// --- Gestion des vues externes : ?d= (à confirmer) et ?c= (à vérifier) ---

async function initVuesExternes(){
  const params = new URLSearchParams(location.search);
  const dParam = params.get('d');
  const cParam = params.get('c');

  if (dParam){
    const dossier = decodePayload(dParam);
    if (!dossier) return;

    document.getElementById('topbarNormal').style.display = 'none';
    document.getElementById('mainNormal').style.display = 'none';
    document.getElementById('footerNormal').style.display = 'none';
    document.getElementById('vueConfirmation').classList.remove('hidden');

    document.getElementById('cfTitre').textContent = dossier.titre || 'Dossier sans titre';
    document.getElementById('cfType').textContent = dossier.type || '—';
    document.getElementById('cfMontant').textContent = dossier.montant ? `${dossier.montant} FCFA` : 'Non précisé';
    document.getElementById('cfTexte').textContent = dossier.texte || 'Non précisé';
    document.getElementById('cfDate').textContent = formatDate(new Date(dossier.date));
    document.getElementById('cfHash').textContent = dossier.hash;

    document.getElementById('confirmForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nom = document.getElementById('cfNom').value.trim();
      const tel = document.getElementById('cfTel').value.trim();
      const ts2 = new Date().toISOString();

      const confHash = await hashText(`${dossier.hash}|${nom}|${tel}|${ts2}`);
      const confirmation = {
        hashOrigine: dossier.hash,
        titre: dossier.titre,
        nom, tel, ts2, confHash
      };

      document.getElementById('confirmForm').closest('.confirm-card').classList.add('hidden');
      const res = document.getElementById('cfResultat');
      res.classList.remove('hidden');

      const lien = buildConfirmLink(confirmation);
      document.getElementById('cfShareLink').value = lien;

      const msgWa = `Bonjour, j'ai confirmé l'accord "${dossier.titre}" sur Preuv'. Voici le certificat de confirmation : ${lien}`;
      document.getElementById('btnWhatsappConfirm').href = `https://wa.me/?text=${encodeURIComponent(msgWa)}`;

      document.getElementById('btnCopierConfirm').addEventListener('click', (e2) => {
        copyToClipboard(lien, e2.target);
      });
      document.getElementById('btnImprimerConfirm').addEventListener('click', () => window.print());
    });

    return;
  }

  if (cParam){
    const confirmation = decodePayload(cParam);
    document.getElementById('topbarNormal').style.display = 'none';
    document.getElementById('mainNormal').style.display = 'none';
    document.getElementById('footerNormal').style.display = 'none';
    document.getElementById('vueVerification').classList.remove('hidden');

    if (!confirmation){
      document.getElementById('vfCarteValide').classList.add('hidden');
      document.getElementById('vfCarteInvalide').classList.remove('hidden');
      return;
    }

    // Recalcul local du hash de confirmation pour vérifier l'intégrité
    const attendu = await hashText(`${confirmation.hashOrigine}|${confirmation.nom}|${confirmation.tel}|${confirmation.ts2}`);
    const valide = attendu === confirmation.confHash;

    if (!valide){
      document.getElementById('vfCarteValide').classList.add('hidden');
      document.getElementById('vfCarteInvalide').classList.remove('hidden');
      return;
    }

    document.getElementById('vfNom').textContent = confirmation.nom;
    document.getElementById('vfTel').textContent = confirmation.tel;
    document.getElementById('vfDate').textContent = formatDate(new Date(confirmation.ts2));
    document.getElementById('vfHashOrigine').textContent = confirmation.hashOrigine;

    document.getElementById('btnImprimerVerif').addEventListener('click', () => window.print());

    document.getElementById('btnEnregistrerConfirmation').addEventListener('click', (e) => {
      const all = getDossiers();
      const idx = all.findIndex(d => d.hash === confirmation.hashOrigine);
      if (idx !== -1){
        all[idx].confirmation = {
          nom: confirmation.nom,
          tel: confirmation.tel,
          date: confirmation.ts2
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
        e.target.textContent = 'Enregistré ✓';
        e.target.disabled = true;
      } else {
        e.target.textContent = 'Dossier d\'origine introuvable sur cet appareil';
        e.target.disabled = true;
      }
    });
  }
}

initVuesExternes();

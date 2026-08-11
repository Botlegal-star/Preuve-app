// Preuv' — prototype client-only
// Stockage local uniquement pour cette démo (localStorage)

const STORAGE_KEY = 'preuve_dossiers_v1';

function getDossiers(){
  try{
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    let changed = false;
    all.forEach(d => { if (!d.id){ d.id = genId(); changed = true; } });
    if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    return all;
  }catch(e){
    return [];
  }
}

function genId(){
  return 'd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8);
}

function saveDossier(d){
  const all = getDossiers();
  all.unshift(d);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

function updateDossier(id, changes){
  const all = getDossiers();
  const idx = all.findIndex(d => d.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...changes };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  return all[idx];
}

function deleteDossier(id){
  const all = getDossiers().filter(d => d.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

function getDossierById(id){
  return getDossiers().find(d => d.id === id) || null;
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

// --- Assistant de détection de risque (V1 : règles, pas encore une vraie IA connectée) ---

function analyserRisques({ texte, type, montant }){
  const t = (texte || '').toLowerCase();
  const alertes = [];

  const aUneDate = /(\d{1,2}\s*(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)|\d{1,2}\/\d{1,2}|avant le|d'ici|délai|le lendemain|sous \d+ (jour|jours|semaine|semaines))/i.test(t);
  const aMoyenPaiement = /(mobile money|momo|mtn money|moov money|espèces|especes|cash|virement|chèque|cheque)/i.test(t);
  const aClauseAnnulation = /(annulation|remboursement|rétractation|retractation|dédommagement|penalite|pénalité)/i.test(t);
  const tauxMatch = t.match(/(\d{1,3})\s*%/);

  if ((type === 'Vente' || type === 'Service') && !aUneDate){
    alertes.push({
      niveau:'alerte',
      message:"Aucune date ou délai précis détecté. Sans date de livraison ou d'exécution, il sera difficile de prouver un retard en cas de litige. Ajoutez une date précise."
    });
  }

  if (montant && !aMoyenPaiement){
    alertes.push({
      niveau:'conseil',
      message:"Le moyen de paiement n'est pas précisé (Mobile Money, espèces, virement...). Mentionnez-le : c'est souvent la première chose vérifiée en cas de désaccord."
    });
  }

  if (type === 'Prêt / dette'){
    if (tauxMatch){
      const taux = parseInt(tauxMatch[1], 10);
      if (taux > 10){
        alertes.push({
          niveau:'alerte',
          message:`Un taux d'intérêt de ${taux}% a été mentionné. Au-delà de certains seuils, un taux d'intérêt élevé peut être considéré comme usuraire et donc illégal. Vérifiez ce point avant de vous engager.`
        });
      }
    } else {
      alertes.push({
        niveau:'conseil',
        message:"Il s'agit d'un prêt, mais aucun taux d'intérêt (ou l'absence d'intérêt) n'est précisé. Clarifiez ce point pour éviter toute ambiguïté."
      });
    }
    if (!aUneDate){
      alertes.push({
        niveau:'alerte',
        message:"Aucune date de remboursement détectée. Un prêt sans échéance claire est très difficile à faire valoir en cas de non-remboursement."
      });
    }
  }

  if (type === 'Location' && !aClauseAnnulation){
    alertes.push({
      niveau:'conseil',
      message:"Aucune clause sur l'annulation, la caution ou le remboursement en cas de désaccord. Préciser ces conditions renforce beaucoup le dossier."
    });
  }

  if (t.length > 0 && t.length < 20){
    alertes.push({
      niveau:'conseil',
      message:"Le résumé est très court. Plus vous détaillez qui s'engage à quoi et quand, plus le dossier aura de valeur en cas de désaccord."
    });
  }

  return alertes;
}

function renderAlertes(container, alertes){
  if (!alertes.length){
    container.innerHTML = '<p class="alerte-ok">✓ Aucun point de vigilance détecté sur ce résumé.</p>';
    return;
  }
  container.innerHTML = alertes.map(a => `
    <div class="alerte-item alerte-${a.niveau}">
      <span class="alerte-icone">${a.niveau === 'alerte' ? '⚠️' : '💡'}</span>
      <span>${escapeHtml(a.message)}</span>
    </div>
  `).join('');
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
      <div class="di-info">
        <div class="di-title">${escapeHtml(d.titre)} ${d.confirmation ? '<span class="badge-confirme">✓ confirmé</span>' : ''}</div>
        <div class="di-meta">${escapeHtml(d.type)} · ${formatDate(new Date(d.date))}${d.confirmation ? ` · confirmé par ${escapeHtml(d.confirmation.nom)}` : ''}</div>
        <div class="di-hash">${d.hash.slice(0,12)}…</div>
      </div>
      <div class="di-actions">
        <button class="di-btn" data-action="voir" data-id="${d.id}">Voir</button>
        <button class="di-btn" data-action="modifier" data-id="${d.id}">Modifier</button>
        <button class="di-btn di-btn-danger" data-action="supprimer" data-id="${d.id}">Supprimer</button>
      </div>
    </div>
  `).join('');
}

// Actions sur la liste (délégation d'événements)
document.getElementById('listeDossiers').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;

  if (action === 'supprimer'){
    if (confirm('Supprimer définitivement ce dossier ? Cette action est irréversible.')){
      deleteDossier(id);
      renderDossiers();
    }
  }

  if (action === 'voir'){
    const d = getDossierById(id);
    if (d) afficherResultat(d, { modeEdition:false });
    document.getElementById('creer').scrollIntoView({ behavior:'smooth' });
  }

  if (action === 'modifier'){
    const d = getDossierById(id);
    if (!d) return;
    document.getElementById('titre').value = d.titre;
    document.getElementById('type').value = d.type;
    document.getElementById('montant').value = d.montant || '';
    document.getElementById('texte').value = d.texte || '';
    form.dataset.editingId = id;
    document.getElementById('btnSubmitForm').textContent = 'Mettre à jour la certification';
    document.getElementById('editNotice').classList.remove('hidden');
    document.getElementById('resultat').classList.add('hidden');
    document.getElementById('creer').scrollIntoView({ behavior:'smooth' });
  }
});

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

function buildVerifyLink(dossier){
  const payload = {
    titre: dossier.titre,
    type: dossier.type,
    montant: dossier.montant,
    texte: dossier.texte,
    hash: dossier.hash,
    date: dossier.date,
    confirmation: dossier.confirmation || null
  };
  const base = location.origin + location.pathname;
  return `${base}?v=${encodePayload(payload)}`;
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

function afficherResultat(dossier, { modeEdition } = {}){
  document.getElementById('resTitre').textContent = dossier.titre || 'Dossier sans titre';
  document.getElementById('resDate').textContent = formatDate(new Date(dossier.date));
  document.getElementById('resHash').textContent = dossier.hash;

  const force = evaluerForce({ texte: dossier.texte, montant: dossier.montant, fichier: dossier.fichierNom, type: dossier.type });
  document.getElementById('resForce').textContent = force.niveau;

  const conseilEl = document.getElementById('resConseil');
  if (force.manque.length){
    conseilEl.textContent = 'Pour renforcer ce dossier, ajoutez : ' + force.manque.join(', ') + '.';
    conseilEl.classList.add('weak');
  } else {
    conseilEl.textContent = 'Ce dossier contient les éléments essentiels pour servir de preuve en cas de litige.';
    conseilEl.classList.remove('weak');
  }

  // Points de vigilance figés au moment de la certification
  const alertesBloc = document.getElementById('resAlertes');
  const alertes = dossier.alertes || [];
  if (alertes.length){
    renderAlertes(document.getElementById('resAlertesListe'), alertes);
    alertesBloc.classList.remove('hidden');
  } else {
    alertesBloc.classList.add('hidden');
  }

  document.getElementById('resultat').classList.remove('hidden');
  document.getElementById('resultat').scrollIntoView({ behavior:'smooth', block:'center' });

  const lien = buildShareLink(dossier);
  document.getElementById('shareLink').value = lien;
  const msgWa = `Bonjour, je vous partage le dossier "${dossier.titre}" certifié sur Preuv' pour confirmation : ${lien}`;
  document.getElementById('btnWhatsappPartage').href = `https://wa.me/?text=${encodeURIComponent(msgWa)}`;

  // QR code pointant vers le certificat vérifiable en lecture seule
  const qrContainer = document.getElementById('qrCode');
  qrContainer.innerHTML = '';
  if (window.QRCode){
    new QRCode(qrContainer, {
      text: buildVerifyLink(dossier),
      width: 96,
      height: 96,
      colorDark: '#1B2A4A',
      colorLight: '#ffffff'
    });
  }
}

// Analyse de risque en direct pendant la saisie
let debounceTimer;
function declencherAnalyseEnDirect(){
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const texte = document.getElementById('texte').value.trim();
    const type = document.getElementById('type').value;
    const montant = document.getElementById('montant').value;
    const container = document.getElementById('analyseRisques');
    if (!texte){
      container.innerHTML = '<p class="alerte-ok">Commencez à décrire l\'accord pour voir l\'analyse.</p>';
      return;
    }
    renderAlertes(container, analyserRisques({ texte, type, montant }));
  }, 400);
}
document.getElementById('texte').addEventListener('input', declencherAnalyseEnDirect);
document.getElementById('type').addEventListener('change', declencherAnalyseEnDirect);
document.getElementById('montant').addEventListener('input', declencherAnalyseEnDirect);

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
  const editingId = form.dataset.editingId;
  const alertes = analyserRisques({ texte, type, montant });

  // Construire l'empreinte à partir de tous les éléments du dossier
  let combined = `${titre}|${type}|${montant}|${texte}|${Date.now()}`;
  let fileHash = null;
  if (fichier){
    fileHash = await hashFile(fichier);
    combined += `|${fileHash}`;
  }
  const hash = await hashText(combined);
  const date = new Date();

  let dossier;
  if (editingId){
    // Modification : le contenu ayant changé, une nouvelle empreinte et un nouvel horodatage
    // sont générés — toute confirmation précédente devient invalide et est réinitialisée.
    dossier = updateDossier(editingId, {
      titre, type, montant, texte, hash, alertes,
      date: date.toISOString(),
      fichierNom: fichier ? fichier.name : null,
      confirmation: null
    });
    delete form.dataset.editingId;
    document.getElementById('btnSubmitForm').textContent = 'Générer la certification';
    document.getElementById('editNotice').classList.add('hidden');
  } else {
    dossier = { id: genId(), titre, type, montant, texte, hash, alertes, date: date.toISOString(), fichierNom: fichier ? fichier.name : null };
    saveDossier(dossier);
  }

  renderDossiers();
  afficherResultat(dossier);
});

document.getElementById('btnCopierLien').addEventListener('click', (e) => {
  copyToClipboard(document.getElementById('shareLink').value, e.target);
});

document.getElementById('btnNouveau').addEventListener('click', () => {
  form.reset();
  delete form.dataset.editingId;
  document.getElementById('btnSubmitForm').textContent = 'Générer la certification';
  document.getElementById('editNotice').classList.add('hidden');
  document.getElementById('resultat').classList.add('hidden');
  document.getElementById('creer').scrollIntoView({ behavior:'smooth' });
});

document.getElementById('btnImprimer').addEventListener('click', () => {
  window.print();
});

window.addEventListener('beforeprint', () => {
  const el = document.getElementById('printDateGen');
  if (el) el.textContent = formatDate(new Date());
});

renderDossiers();

// --- Gestion des vues externes : ?d= (à confirmer) et ?c= (à vérifier) ---

async function initVuesExternes(){
  const params = new URLSearchParams(location.search);
  const dParam = params.get('d');
  const cParam = params.get('c');
  const vParam = params.get('v');

  if (vParam){
    const dossier = decodePayload(vParam);
    document.getElementById('topbarNormal').style.display = 'none';
    document.getElementById('mainNormal').style.display = 'none';
    document.getElementById('footerNormal').style.display = 'none';
    document.getElementById('vueCertificat').classList.remove('hidden');

    if (!dossier) return;

    document.getElementById('vcTitre').textContent = dossier.titre || 'Dossier sans titre';
    document.getElementById('vcType').textContent = dossier.type || '—';
    document.getElementById('vcMontant').textContent = dossier.montant ? `${dossier.montant} FCFA` : 'Non précisé';
    document.getElementById('vcTexte').textContent = dossier.texte || 'Non précisé';
    document.getElementById('vcDate').textContent = formatDate(new Date(dossier.date));
    document.getElementById('vcHash').textContent = dossier.hash;

    if (dossier.confirmation){
      document.getElementById('vcConfirmationBloc').classList.remove('hidden');
      document.getElementById('vcConfirmeParNom').textContent = dossier.confirmation.nom;
      document.getElementById('vcConfirmeDate').textContent = formatDate(new Date(dossier.confirmation.date));
    }
    return;
  }

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

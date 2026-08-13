// Preuv' — V2 : Firebase (Authentication + Firestore) comme backend

const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
let dossiersCache = [];
let unsubscribeDossiers = null;

// --- Utilitaires génériques ---

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
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

function formatDate(d){
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'medium' }).format(d);
}

function formatDateFirestore(ts){
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return formatDate(d);
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

// --- Assistant de détection de risque (V1 : règles, pas encore une IA connectée) ---

function analyserRisques({ texte, type, montant }){
  const t = (texte || '').toLowerCase();
  const alertes = [];

  const aUneDate = /(\d{1,2}\s*(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)|\d{1,2}\/\d{1,2}|avant le|d'ici|délai|le lendemain|sous \d+ (jour|jours|semaine|semaines))/i.test(t);
  const aMoyenPaiement = /(mobile money|momo|mtn money|moov money|espèces|especes|cash|virement|chèque|cheque)/i.test(t);
  const aClauseAnnulation = /(annulation|remboursement|rétractation|retractation|dédommagement|penalite|pénalité)/i.test(t);
  const tauxMatch = t.match(/(\d{1,3})\s*%/);

  if ((type === 'Vente' || type === 'Service') && !aUneDate){
    alertes.push({ niveau:'alerte', message:"Aucune date ou délai précis détecté. Sans date de livraison ou d'exécution, il sera difficile de prouver un retard en cas de litige. Ajoutez une date précise." });
  }
  if (montant && !aMoyenPaiement){
    alertes.push({ niveau:'conseil', message:"Le moyen de paiement n'est pas précisé (Mobile Money, espèces, virement...). Mentionnez-le : c'est souvent la première chose vérifiée en cas de désaccord." });
  }
  if (type === 'Prêt / dette'){
    if (tauxMatch){
      const taux = parseInt(tauxMatch[1], 10);
      if (taux > 10){
        alertes.push({ niveau:'alerte', message:`Un taux d'intérêt de ${taux}% a été mentionné. Au-delà de certains seuils, un taux d'intérêt élevé peut être considéré comme usuraire et donc illégal. Vérifiez ce point avant de vous engager.` });
      }
    } else {
      alertes.push({ niveau:'conseil', message:"Il s'agit d'un prêt, mais aucun taux d'intérêt (ou l'absence d'intérêt) n'est précisé. Clarifiez ce point pour éviter toute ambiguïté." });
    }
    if (!aUneDate){
      alertes.push({ niveau:'alerte', message:"Aucune date de remboursement détectée. Un prêt sans échéance claire est très difficile à faire valoir en cas de non-remboursement." });
    }
  }
  if (type === 'Location' && !aClauseAnnulation){
    alertes.push({ niveau:'conseil', message:"Aucune clause sur l'annulation, la caution ou le remboursement en cas de désaccord. Préciser ces conditions renforce beaucoup le dossier." });
  }
  if (t.length > 0 && t.length < 20){
    alertes.push({ niveau:'conseil', message:"Le résumé est très court. Plus vous détaillez qui s'engage à quoi et quand, plus le dossier aura de valeur en cas de désaccord." });
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

// --- Authentification ---

let authMode = 'login';

function afficherAuthPanel(mode){
  authMode = mode;
  document.getElementById('authErreur').style.display = 'none';
  if (mode === 'login'){
    document.getElementById('authTitre').textContent = 'Connexion';
    document.getElementById('authSousTitre').textContent = 'Accédez à vos dossiers';
    document.getElementById('btnAuthValider').textContent = 'Se connecter';
    document.getElementById('authBascule1').classList.remove('hidden');
    document.getElementById('authBascule2').classList.add('hidden');
  } else {
    document.getElementById('authTitre').textContent = 'Créer un compte';
    document.getElementById('authSousTitre').textContent = 'Gratuit, en 30 secondes';
    document.getElementById('btnAuthValider').textContent = 'Créer mon compte';
    document.getElementById('authBascule1').classList.add('hidden');
    document.getElementById('authBascule2').classList.remove('hidden');
  }
  document.getElementById('topbarNormal').style.display = 'none';
  document.getElementById('mainNormal').style.display = 'none';
  document.getElementById('footerNormal').style.display = 'none';
  document.getElementById('authPanel').classList.remove('hidden');
}

function fermerAuthPanel(){
  document.getElementById('authPanel').classList.add('hidden');
  document.getElementById('topbarNormal').style.display = '';
  document.getElementById('mainNormal').style.display = '';
  document.getElementById('footerNormal').style.display = '';
}

document.getElementById('btnOuvrirAuth').addEventListener('click', () => afficherAuthPanel('login'));
document.getElementById('btnCreerCompteDepuisCreer').addEventListener('click', () => afficherAuthPanel('signup'));
document.getElementById('btnCreerCompteDepuisDossiers').addEventListener('click', () => afficherAuthPanel('login'));
document.getElementById('btnFermerAuth').addEventListener('click', fermerAuthPanel);
document.getElementById('lienVersInscription').addEventListener('click', (e) => { e.preventDefault(); afficherAuthPanel('signup'); });
document.getElementById('lienVersConnexion').addEventListener('click', (e) => { e.preventDefault(); afficherAuthPanel('login'); });

document.getElementById('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('authEmail').value.trim();
  const mdp = document.getElementById('authMdp').value;
  const erreurEl = document.getElementById('authErreur');
  erreurEl.style.display = 'none';

  try{
    if (authMode === 'login'){
      await auth.signInWithEmailAndPassword(email, mdp);
    } else {
      await auth.createUserWithEmailAndPassword(email, mdp);
    }
    fermerAuthPanel();
  }catch(err){
    const messages = {
      'auth/email-already-in-use': 'Un compte existe déjà avec cet e-mail — essayez de vous connecter.',
      'auth/invalid-email': 'Adresse e-mail invalide.',
      'auth/weak-password': 'Le mot de passe doit contenir au moins 6 caractères.',
      'auth/wrong-password': 'Mot de passe incorrect.',
      'auth/user-not-found': 'Aucun compte trouvé avec cet e-mail.',
      'auth/invalid-credential': 'E-mail ou mot de passe incorrect.'
    };
    erreurEl.textContent = messages[err.code] || 'Une erreur est survenue : ' + err.message;
    erreurEl.style.display = 'block';
  }
});

document.getElementById('btnDeconnexion').addEventListener('click', () => auth.signOut());

auth.onAuthStateChanged((user) => {
  currentUser = user;
  if (user){
    document.getElementById('btnOuvrirAuth').classList.add('hidden');
    document.getElementById('authStatusConnecte').classList.remove('hidden');
    document.getElementById('authEmailAffiche').textContent = user.email;
    document.getElementById('creerVerrou').classList.add('hidden');
    document.getElementById('creerProtege').classList.remove('hidden');
    document.getElementById('dossiersVerrou').classList.add('hidden');
    document.getElementById('listeDossiers').classList.remove('hidden');
    demarrerEcouteDossiers(user.uid);
  } else {
    document.getElementById('btnOuvrirAuth').classList.remove('hidden');
    document.getElementById('authStatusConnecte').classList.add('hidden');
    document.getElementById('creerVerrou').classList.remove('hidden');
    document.getElementById('creerProtege').classList.add('hidden');
    document.getElementById('dossiersVerrou').classList.remove('hidden');
    document.getElementById('listeDossiers').classList.add('hidden');
    dossiersCache = [];
    if (unsubscribeDossiers){ unsubscribeDossiers(); unsubscribeDossiers = null; }
  }
});

// --- Dossiers (Firestore) ---

function demarrerEcouteDossiers(uid){
  if (unsubscribeDossiers) unsubscribeDossiers();
  unsubscribeDossiers = db.collection('dossiers')
    .where('ownerId', '==', uid)
    .orderBy('createdAt', 'desc')
    .onSnapshot((snap) => {
      dossiersCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderDossiers();
    }, (err) => {
      console.error('Erreur de synchronisation Firestore :', err);
    });
}

function getDossierById(id){
  return dossiersCache.find(d => d.id === id) || null;
}

async function creerDossierFirestore(data){
  const ref = await db.collection('dossiers').add({
    ...data,
    ownerId: currentUser.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  return ref.id;
}

async function mettreAJourDossierFirestore(id, changes){
  await db.collection('dossiers').doc(id).update(changes);
}

async function supprimerDossierFirestore(id){
  await db.collection('dossiers').doc(id).delete();
}

function renderDossiers(){
  const list = document.getElementById('listeDossiers');
  if (dossiersCache.length === 0){
    list.innerHTML = '<p class="empty">Aucun dossier pour le moment. Créez-en un pour le voir apparaître ici.</p>';
    return;
  }
  list.innerHTML = dossiersCache.map(d => `
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

document.getElementById('listeDossiers').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;

  if (action === 'supprimer'){
    if (confirm('Supprimer définitivement ce dossier ? Cette action est irréversible.')){
      await supprimerDossierFirestore(id);
    }
  }

  if (action === 'voir'){
    const d = getDossierById(id);
    if (d) afficherResultat(d);
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

// --- Lien de partage : juste l'identifiant Firestore (très court, plus besoin d'encoder tout le contenu) ---

function buildDossierLink(id){
  const base = location.origin + location.pathname;
  return `${base}?doc=${id}`;
}

// Navigation
document.querySelectorAll('[data-goto]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById(btn.dataset.goto).scrollIntoView({ behavior:'smooth' });
  });
});

function afficherResultat(dossier){
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

  const lien = buildDossierLink(dossier.id);
  document.getElementById('shareLink').value = lien;
  const msgWa = `Bonjour, je vous partage le dossier "${dossier.titre}" certifié sur Preuv' pour confirmation : ${lien}`;
  document.getElementById('btnWhatsappPartage').href = `https://wa.me/?text=${encodeURIComponent(msgWa)}`;

  const qrContainer = document.getElementById('qrCode');
  qrContainer.innerHTML = '';
  if (window.QRCode){
    new QRCode(qrContainer, {
      text: lien,
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

// Formulaire principal
const form = document.getElementById('dossierForm');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser){ afficherAuthPanel('login'); return; }

  const titre = document.getElementById('titre').value.trim();
  const type = document.getElementById('type').value;
  const montant = document.getElementById('montant').value;
  const texte = document.getElementById('texte').value.trim();
  const fichierInput = document.getElementById('fichier');
  const fichier = fichierInput.files[0];
  const editingId = form.dataset.editingId;
  const alertes = analyserRisques({ texte, type, montant });

  let combined = `${titre}|${type}|${montant}|${texte}|${Date.now()}`;
  let fileHash = null;
  if (fichier){
    fileHash = await hashFile(fichier);
    combined += `|${fileHash}`;
  }
  const hash = await hashText(combined);
  const date = new Date();

  const btnSubmit = document.getElementById('btnSubmitForm');
  const texteOriginalBtn = btnSubmit.textContent;
  btnSubmit.textContent = 'En cours...';
  btnSubmit.disabled = true;

  let dossierId;
  const donnees = { titre, type, montant, texte, hash, alertes, date: date.toISOString(), fichierNom: fichier ? fichier.name : null };

  try{
    if (editingId){
      await mettreAJourDossierFirestore(editingId, { ...donnees, confirmation: null });
      dossierId = editingId;
      delete form.dataset.editingId;
      document.getElementById('editNotice').classList.add('hidden');
    } else {
      dossierId = await creerDossierFirestore(donnees);
    }
  } finally {
    btnSubmit.textContent = 'Générer la certification';
    btnSubmit.disabled = false;
  }

  afficherResultat({ id: dossierId, ...donnees });
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

document.getElementById('btnImprimer').addEventListener('click', () => window.print());

window.addEventListener('beforeprint', () => {
  const el = document.getElementById('printDateGen');
  if (el) el.textContent = formatDate(new Date());
});

// --- Vue externe unique : ?doc=<id> (ouverte via WhatsApp ou le QR code) ---
// Si pas encore confirmé : formulaire de confirmation (écrit directement dans Firestore).
// Si déjà confirmé : certificat en lecture seule.

async function initVueExterne(){
  const params = new URLSearchParams(location.search);
  const docId = params.get('doc');
  if (!docId) return;

  document.getElementById('topbarNormal').style.display = 'none';
  document.getElementById('mainNormal').style.display = 'none';
  document.getElementById('footerNormal').style.display = 'none';

  let snap;
  try{
    snap = await db.collection('dossiers').doc(docId).get();
  }catch(err){
    snap = null;
  }

  if (!snap || !snap.exists){
    document.getElementById('vueCertificat').classList.remove('hidden');
    document.getElementById('vcCarteValide').classList.add('hidden');
    document.getElementById('vcCarteInvalide').classList.remove('hidden');
    return;
  }

  const dossier = snap.data();

  if (dossier.confirmation){
    // Déjà confirmé : certificat en lecture seule
    document.getElementById('vueCertificat').classList.remove('hidden');
    document.getElementById('vcTitre').textContent = dossier.titre || 'Dossier sans titre';
    document.getElementById('vcType').textContent = dossier.type || '—';
    document.getElementById('vcMontant').textContent = dossier.montant ? `${dossier.montant} FCFA` : 'Non précisé';
    document.getElementById('vcTexte').textContent = dossier.texte || 'Non précisé';
    document.getElementById('vcDate').textContent = formatDate(new Date(dossier.date));
    document.getElementById('vcHash').textContent = dossier.hash;
    document.getElementById('vcConfirmationBloc').classList.remove('hidden');
    document.getElementById('vcConfirmeParNom').textContent = dossier.confirmation.nom;
    document.getElementById('vcConfirmeDate').textContent = formatDate(new Date(dossier.confirmation.date));
    return;
  }

  // Pas encore confirmé : formulaire de confirmation
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

    const submitBtn = e.target.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Enregistrement...';

    try{
      await db.collection('dossiers').doc(docId).update({
        confirmation: { nom, tel, date: ts2, confHash }
      });
      document.getElementById('confirmForm').closest('.confirm-card').classList.add('hidden');
      document.getElementById('cfResultat').classList.remove('hidden');
      document.getElementById('btnImprimerConfirm').addEventListener('click', () => window.print());
    }catch(err){
      submitBtn.disabled = false;
      submitBtn.textContent = 'Je confirme cet accord';
      alert("La confirmation n'a pas pu être enregistrée. Vérifiez votre connexion et réessayez.");
    }
  });
}

initVueExterne();

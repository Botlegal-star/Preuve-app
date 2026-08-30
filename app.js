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

// --- Jeu d'icônes vectorielles (remplace les émojis dans toute l'app) ---

const ICONES = {
  cadenas: '<svg class="icon-inline" viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M7.5 11V7.5a4.5 4.5 0 0 1 9 0V11"/></svg>',
  bouclier: '<svg class="icon-inline" viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z"/></svg>',
  recherche: '<svg class="icon-inline" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  colis: '<svg class="icon-inline" viewBox="0 0 24 24"><rect x="3.5" y="8" width="17" height="12" rx="1"/><path d="M3.5 8l8.5-4.5L20.5 8"/><path d="M12 8v12"/></svg>',
  horloge: '<svg class="icon-inline" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/></svg>',
  alerte: '<svg class="icon-inline" viewBox="0 0 24 24"><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4"/><circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none"/></svg>',
  info: '<svg class="icon-inline" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="8.2" r="1" fill="currentColor" stroke="none"/><path d="M12 11v5"/></svg>',
  crayon: '<svg class="icon-inline" viewBox="0 0 24 24"><path d="M4 20l1-4 12-12 3 3-12 12z"/><path d="M14 5l3 3"/></svg>',
  bulle: '<svg class="icon-inline" viewBox="0 0 24 24"><path d="M4 4.5h16v12H8.5L4 20.5z"/></svg>',
  coche: '<svg class="icon-inline icon-check-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.7 2.7L16 9"/></svg>',
  croix: '<svg class="icon-inline icon-x-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>',
  parchemin: '<svg class="icon-inline" viewBox="0 0 24 24"><path d="M6 3.5h9l4 4V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/><path d="M8.5 10h7M8.5 13.5h7M8.5 17h4"/></svg>'
};

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

function evaluerForce({ texte, montant, fichier, type, titre }){
  const t = (texte || '').toLowerCase();
  const aUneDate = /(\d{1,2}\s*(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)|\d{1,2}\/\d{1,2}|avant le|d'ici|délai|le lendemain|sous \d+ (jour|jours|semaine|semaines))/i.test(t);
  const aMoyenPaiement = /(mobile money|momo|mtn money|moov money|espèces|especes|cash|virement|chèque|cheque)/i.test(t);

  const items = [
    { label: 'Titre du dossier renseigné', ok: !!(titre && titre.trim()) },
    { label: "Type d'accord précisé", ok: !!type },
    { label: 'Montant renseigné', ok: !!montant },
    { label: 'Résumé détaillé (au moins 20 caractères)', ok: !!(texte && texte.trim().length > 20) },
    { label: 'Pièce jointe ajoutée', ok: !!fichier },
    { label: 'Date ou délai mentionné', ok: aUneDate },
    { label: 'Moyen de paiement mentionné', ok: aMoyenPaiement }
  ];

  const nbOk = items.filter(i => i.ok).length;
  const pourcentage = Math.round((nbOk / items.length) * 100);
  let niveau = 'Incomplet', classe = 'weak';
  if (pourcentage >= 85){ niveau = 'Solide'; classe = ''; }
  else if (pourcentage >= 55){ niveau = 'Correct, peut être renforcé'; classe = ''; }

  const manque = items.filter(i => !i.ok).map(i => i.label);
  return { niveau, classe, manque, items, pourcentage };
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
      <span class="alerte-icone">${a.niveau === 'alerte' ? ICONES.alerte : ICONES.info}</span>
      <span>${escapeHtml(a.message)}</span>
    </div>
  `).join('');
}

function buildTimelineHTML(dossier){
  const etapes = [
    { titre: 'Accord créé et certifié', date: dossier.date, fait: true },
    { titre: "Consulté par l'autre partie", date: dossier.consulteLe || null, fait: !!dossier.consulteLe },
    { titre: 'Confirmé par les deux parties', date: dossier.confirmation ? dossier.confirmation.date : null, fait: !!dossier.confirmation },
    { titre: 'Réception confirmée', date: dossier.livraison ? dossier.livraison.date : null, fait: !!dossier.livraison }
  ];
  return etapes.map(et => `
    <div class="timeline-step ${et.fait ? 'done' : ''}">
      <div class="timeline-marker">
        <div class="timeline-dot"></div>
        <div class="timeline-connector"></div>
      </div>
      <div class="timeline-content">
        <div class="timeline-title">${et.fait ? '✓ ' : '○ '}${et.titre}</div>
        <div class="timeline-date">${et.fait ? formatDate(new Date(et.date)) : 'En attente'}</div>
      </div>
    </div>
  `).join('');
}

// --- Score de confiance ---

function calculerScore(dossiers){
  const total = dossiers.length;
  if (total === 0){
    return { score: 0, total: 0, tauxConfirmation: null, tauxLivraison: null };
  }
  const confirmes = dossiers.filter(d => d.confirmation).length;
  const livres = dossiers.filter(d => d.livraison).length;
  const tauxConfirmation = confirmes / total;
  const tauxLivraison = livres / total;

  const pointsActivite = Math.min(total * 5, 30);
  const pointsConfirmation = Math.round(tauxConfirmation * 40);
  const pointsLivraison = Math.round(tauxLivraison * 30);
  const score = Math.min(pointsActivite + pointsConfirmation + pointsLivraison, 100);

  return { score, total, tauxConfirmation, tauxLivraison };
}

function afficherScoreLocal(stats){
  const carte = document.getElementById('scoreCard');
  if (stats.total === 0){
    carte.classList.add('hidden');
    return;
  }
  carte.classList.remove('hidden');
  carte.style.setProperty('--pct', stats.score);
  document.getElementById('scoreValeur').textContent = stats.score;
  document.getElementById('scoreNbDossiers').textContent = stats.total;
  document.getElementById('scoreTauxConfirmation').textContent = Math.round(stats.tauxConfirmation * 100) + '%';
  document.getElementById('scoreTauxLivraison').textContent = Math.round(stats.tauxLivraison * 100) + '%';

  let sousTitre = 'Continuez à certifier et faire confirmer vos accords pour le renforcer.';
  if (stats.score >= 80) sousTitre = 'Excellent historique. Un signal de confiance fort pour vos partenaires.';
  else if (stats.score >= 50) sousTitre = 'Bon départ. Plus vos accords sont confirmés et livrés, plus il grimpe.';
  document.getElementById('scoreSousTitre').textContent = sousTitre;
}

async function synchroniserScorePublic(uid, stats){
  try{
    await db.collection('users').doc(uid).set({
      score: stats.score,
      total: stats.total,
      tauxConfirmation: stats.tauxConfirmation,
      tauxLivraison: stats.tauxLivraison,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }catch(err){
    console.error('Impossible de synchroniser le score public :', err);
  }
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
    document.getElementById('lienMdpOublieBloc').classList.remove('hidden');
  } else {
    document.getElementById('authTitre').textContent = 'Créer un compte';
    document.getElementById('authSousTitre').textContent = 'Gratuit, en 30 secondes';
    document.getElementById('btnAuthValider').textContent = 'Créer mon compte';
    document.getElementById('authBascule1').classList.add('hidden');
    document.getElementById('authBascule2').classList.remove('hidden');
    document.getElementById('lienMdpOublieBloc').classList.add('hidden');
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

document.getElementById('lienMdpOublie').addEventListener('click', async (e) => {
  e.preventDefault();
  const email = document.getElementById('authEmail').value.trim();
  const erreurEl = document.getElementById('authErreur');
  erreurEl.style.display = 'block';

  if (!email){
    erreurEl.textContent = "Renseigne d'abord ton adresse e-mail dans le champ ci-dessus, puis reclique sur ce lien.";
    erreurEl.classList.add('weak');
    return;
  }

  try{
    await auth.sendPasswordResetEmail(email);
    erreurEl.classList.remove('weak');
    erreurEl.textContent = `Un e-mail de réinitialisation a été envoyé à ${email}. Vérifie ta boîte de réception (et les spams).`;
  }catch(err){
    erreurEl.classList.add('weak');
    erreurEl.textContent = "Impossible d'envoyer l'e-mail, vérifie que l'adresse est correcte.";
  }
});

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
      'auth/email-already-in-use': 'Un compte existe déjà avec cet e-mail, essayez de vous connecter.',
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
      const stats = calculerScore(dossiersCache);
      afficherScoreLocal(stats);
      synchroniserScorePublic(uid, stats);
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
        <div class="di-title">${escapeHtml(d.titre)} ${d.confirmation ? `<span class="badge-confirme">${ICONES.coche} confirmé</span>` : ''} ${d.livraison ? `<span class="badge-confirme badge-livraison">${ICONES.colis} livré</span>` : ''}</div>
        <div class="di-meta">${escapeHtml(d.type)} · ${formatDate(new Date(d.date))}${d.confirmation ? ` · confirmé par ${escapeHtml(d.confirmation.nom)}` : ''}${d.livraison ? ` · reçu le ${formatDate(new Date(d.livraison.date))}` : ''}</div>
        <div class="di-hash">${d.hash.slice(0,12)}…</div>
      </div>
      <div class="di-actions">
        <button class="di-btn" data-action="voir" data-id="${d.id}">Voir</button>
        <button class="di-btn" data-action="modifier" data-id="${d.id}">Modifier</button>
        ${d.confirmation && !d.livraison ? `<button class="di-btn" data-action="livraison" data-id="${d.id}">${ICONES.colis} Marquer livré</button>` : ''}
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

  if (action === 'livraison'){
    if (confirm('Confirmer que le bien ou le service décrit dans ce dossier a bien été livré et reçu ?')){
      await mettreAJourDossierFirestore(id, {
        livraison: { date: new Date().toISOString(), note: 'Confirmé depuis le tableau de bord' }
      });
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
    document.getElementById('autrePartieTel').value = d.autrePartieTel || '';
    document.getElementById('vigilanceBloc').classList.add('hidden');
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

document.getElementById('verifierForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const saisie = document.getElementById('verifierInput').value.trim();
  const erreurEl = document.getElementById('verifierErreur');
  erreurEl.style.display = 'none';

  if (!saisie){ return; }

  let id = saisie;
  // Si la personne a collé un lien complet plutôt qu'un simple code, on extrait l'identifiant
  try{
    if (saisie.includes('?doc=')){
      const url = new URL(saisie, location.origin);
      id = url.searchParams.get('doc') || saisie;
    }
  }catch(e){ /* pas une URL valide, on garde tel quel comme code */ }

  id = id.trim();
  if (!id){
    erreurEl.textContent = "Merci de coller un code ou un lien valide.";
    erreurEl.style.display = 'block';
    return;
  }

  location.href = buildDossierLink(id);
});

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
  document.getElementById('resTimeline').innerHTML = buildTimelineHTML(dossier);

  const force = evaluerForce({ texte: dossier.texte, montant: dossier.montant, fichier: dossier.fichierNom, type: dossier.type, titre: dossier.titre });
  document.getElementById('resForce').textContent = `${force.niveau} (${force.pourcentage}%)`;
  document.getElementById('resChecklist').innerHTML = force.items.map(i => `
    <div class="alerte-item ${i.ok ? 'alerte-ok-item' : 'alerte-conseil'}">
      <span class="alerte-icone">${i.ok ? ICONES.coche : ICONES.croix}</span>
      <span>${escapeHtml(i.label)}</span>
    </div>
  `).join('');

  const alertesBloc = document.getElementById('resAlertes');
  const alertes = dossier.alertes || [];
  if (alertes.length){
    renderAlertes(document.getElementById('resAlertesListe'), alertes);
    alertesBloc.classList.remove('hidden');
  } else {
    alertesBloc.classList.add('hidden');
  }

  const histoBloc = document.getElementById('resHistorique');
  const historique = dossier.historique || [];
  if (historique.length){
    document.getElementById('resHistoriqueListe').innerHTML = historique.map((v, i) => `
      <div class="alerte-item alerte-conseil">
        <span class="alerte-icone">v${i + 1}</span>
        <span><strong>${escapeHtml(v.titre)}</strong> · modifié le ${formatDate(new Date(v.date))} · empreinte : <span class="mono">${v.hash.slice(0,16)}…</span></span>
      </div>
    `).join('');
    histoBloc.classList.remove('hidden');
  } else {
    histoBloc.classList.add('hidden');
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

// Vigilance croisée : ce numéro apparaît-il dans d'autres dossiers Preuv' non confirmés ?
let debounceVigilance;
document.getElementById('autrePartieTel').addEventListener('input', (e) => {
  clearTimeout(debounceVigilance);
  const tel = e.target.value.trim();
  const bloc = document.getElementById('vigilanceBloc');
  if (tel.length < 6){ bloc.classList.add('hidden'); return; }

  debounceVigilance = setTimeout(async () => {
    const excludeId = form.dataset.editingId || null;
    const resultat = await verifierVigilance(tel, excludeId);
    afficherVigilance(resultat);
  }, 600);
});

async function verifierVigilance(tel, excludeId){
  try{
    const snap = await db.collection('dossiers').where('autrePartieTel', '==', tel).get();
    let enAttente = 0;
    let total = 0;
    snap.forEach(doc => {
      if (doc.id === excludeId) return;
      total++;
      if (!doc.data().confirmation) enAttente++;
    });
    return { total, enAttente };
  }catch(err){
    console.error('Vérification de vigilance impossible :', err);
    return null;
  }
}

function afficherVigilance(resultat){
  const bloc = document.getElementById('vigilanceBloc');
  const contenu = document.getElementById('vigilanceContenu');
  if (!resultat){ bloc.classList.add('hidden'); return; }

  bloc.classList.remove('hidden');
  if (resultat.total === 0){
    contenu.innerHTML = "<p class=\"alerte-ok\">✓ Ce numéro n'apparaît dans aucun autre dossier Preuv'.</p>";
  } else if (resultat.enAttente > 0){
    contenu.innerHTML = `<div class="alerte-item alerte-alerte"><span class="alerte-icone">${ICONES.alerte}</span><span>Ce numéro apparaît dans <strong>${resultat.enAttente}</strong> autre${resultat.enAttente>1?'s':''} dossier${resultat.enAttente>1?'s':''} Preuv' encore <strong>en attente de confirmation</strong>. Ce n'est pas une preuve de problème, mais ça vaut la peine de vérifier avant de vous engager davantage.</span></div>`;
  } else {
    contenu.innerHTML = `<p class="alerte-ok">Ce numéro apparaît dans ${resultat.total} autre${resultat.total>1?'s':''} dossier${resultat.total>1?'s':''} Preuv', tous déjà confirmés. Plutôt rassurant.</p>`;
  }
}

// Formulaire principal
const form = document.getElementById('dossierForm');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser){ afficherAuthPanel('login'); return; }

  const titre = document.getElementById('titre').value.trim();
  const type = document.getElementById('type').value;
  const montant = document.getElementById('montant').value;
  const texte = document.getElementById('texte').value.trim();
  const autrePartieTel = document.getElementById('autrePartieTel').value.trim();
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
  let historiqueMisAJour = null;
  const donnees = { titre, type, montant, texte, hash, alertes, autrePartieTel: autrePartieTel || null, date: date.toISOString(), fichierNom: fichier ? fichier.name : null };

  try{
    if (editingId){
      const ancienDossier = getDossierById(editingId);
      const ancienneVersion = ancienDossier ? {
        titre: ancienDossier.titre, type: ancienDossier.type, montant: ancienDossier.montant,
        texte: ancienDossier.texte, hash: ancienDossier.hash, date: ancienDossier.date
      } : null;

      const changements = { ...donnees, confirmation: null, livraison: firebase.firestore.FieldValue.delete() };
      if (ancienneVersion){
        historiqueMisAJour = [ ...(ancienDossier.historique || []), ancienneVersion ];
        changements.historique = firebase.firestore.FieldValue.arrayUnion(ancienneVersion);
      }

      await mettreAJourDossierFirestore(editingId, changements);
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

  afficherResultat({ id: dossierId, ...donnees, historique: historiqueMisAJour });
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

  if (dossier.ownerId){
    try{
      const scoreSnap = await db.collection('users').doc(dossier.ownerId).get();
      if (scoreSnap.exists){
        const s = scoreSnap.data();
        document.getElementById('vcScoreBloc').classList.remove('hidden');
        document.getElementById('vcScoreValeur').textContent = s.score;
        document.getElementById('vcScoreDetail').textContent = `${s.total} dossier${s.total > 1 ? 's' : ''} certifié${s.total > 1 ? 's' : ''}`;
      }
    }catch(err){ /* pas grave si indisponible */ }
  }

  if (dossier.confirmation){
    // Déjà confirmé : certificat en lecture seule
    document.getElementById('vueCertificat').classList.remove('hidden');
    document.getElementById('vcTitre').textContent = dossier.titre || 'Dossier sans titre';
    document.getElementById('vcType').textContent = dossier.type || '—';
    document.getElementById('vcMontant').textContent = dossier.montant ? `${dossier.montant} FCFA` : 'Non précisé';
    document.getElementById('vcTexte').textContent = dossier.texte || 'Non précisé';
    document.getElementById('vcDate').textContent = formatDate(new Date(dossier.date));
    document.getElementById('vcHash').textContent = dossier.hash;
    document.getElementById('vcTimeline').innerHTML = buildTimelineHTML(dossier);
    document.getElementById('vcConfirmationBloc').classList.remove('hidden');    document.getElementById('vcConfirmeParNom').textContent = dossier.confirmation.nom;
    document.getElementById('vcConfirmeDate').textContent = formatDate(new Date(dossier.confirmation.date));

    if (dossier.historique && dossier.historique.length){
      document.getElementById('vcHistoriqueListe').innerHTML = dossier.historique.map((v, i) => `
        <div class="alerte-item alerte-conseil">
          <span class="alerte-icone">v${i + 1}</span>
          <span><strong>${escapeHtml(v.titre)}</strong> · version antérieure du ${formatDate(new Date(v.date))} · empreinte : <span class="mono">${v.hash.slice(0,16)}…</span></span>
        </div>
      `).join('');
      document.getElementById('vcHistorique').classList.remove('hidden');
    }

    if (dossier.livraison){
      document.getElementById('vcLivraisonBloc').classList.remove('hidden');
      document.getElementById('vcLivraisonDate').textContent = formatDate(new Date(dossier.livraison.date));
    } else {
      const actionBloc = document.getElementById('vcLivraisonAction');
      actionBloc.classList.remove('hidden');
      document.getElementById('btnConfirmerLivraison').addEventListener('click', async (e) => {
        e.target.disabled = true;
        e.target.textContent = 'Enregistrement...';
        try{
          await db.collection('dossiers').doc(docId).update({
            livraison: { date: new Date().toISOString(), note: 'Confirmé via le lien partagé' }
          });
          actionBloc.classList.add('hidden');
          document.getElementById('vcLivraisonBloc').classList.remove('hidden');
          document.getElementById('vcLivraisonDate').textContent = formatDate(new Date());
        }catch(err){
          e.target.disabled = false;
          e.target.textContent = 'Je confirme avoir reçu ceci';
          alert("La confirmation de réception n'a pas pu être enregistrée. Réessayez.");
        }
      });
    }
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

  if (!dossier.consulteLe){
    db.collection('dossiers').doc(docId).update({ consulteLe: new Date().toISOString() }).catch(() => {});
  }

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

// Petite animation d'ambiance : l'empreinte du hero semble "se calculer"
(function animerHashHero(){
  const el = document.getElementById('heroHash');
  if (!el) return;
  const cible = '8f3a\u2026c02e';
  const chars = '0123456789abcdef';
  let frame = 0;
  const total = 14;
  const tick = setInterval(() => {
    frame++;
    if (frame >= total){
      el.textContent = cible;
      clearInterval(tick);
      return;
    }
    el.textContent = Array.from({ length: 9 }, (_, i) => {
      if (i === 4) return '\u2026';
      return chars[Math.floor(Math.random() * chars.length)];
    }).join('');
  }, 70);
})();

// --- Bot FAQ (V1 : réponses à règles, pas encore une IA connectée) ---

const FAQ = [
  {
    motsCles: ['créer', 'dossier', 'nouveau', 'commencer', 'démarrer'],
    reponse: "Pour créer un dossier : connectez-vous (bouton en haut à droite), allez dans « Nouveau dossier », remplissez le titre, le type d'accord, le résumé, puis cliquez sur « Générer la certification ». Un lien à partager avec l'autre partie apparaît ensuite."
  },
  {
    motsCles: ['score', 'confiance', 'trust', 'note', 'réputation'],
    reponse: "Le score de confiance (sur 100) reflète votre historique sur Preuv' : nombre de dossiers certifiés, taux de confirmation par l'autre partie, et taux de livraison confirmée. Il est visible publiquement dans vos certificats, pour rassurer vos partenaires."
  },
  {
    motsCles: ['gratuit', 'payant', 'prix', 'coût', 'abonnement', 'tarif'],
    reponse: "Preuv' est actuellement entièrement gratuit, en phase de test. Aucun frais n'est prélevé pour l'instant."
  },
  {
    motsCles: ['confirmer', 'confirmation', 'autre partie', 'deuxième'],
    reponse: "Après avoir certifié un dossier, un lien apparaît (à envoyer par WhatsApp par exemple). L'autre partie l'ouvre, vérifie les informations, entre son nom et son téléphone, puis clique sur « Je confirme cet accord ». Vous voyez alors la confirmation apparaître automatiquement dans « Mes dossiers »."
  },
  {
    motsCles: ['livraison', 'réception', 'reçu', 'livré'],
    reponse: "Une fois un dossier confirmé, un bouton « Marquer livré » apparaît dans votre tableau de bord, ou l'autre partie peut confirmer elle-même la réception depuis le lien du certificat."
  },
  {
    motsCles: ['sécurisé', 'sécurité', 'données', 'privé', 'confidentialité', 'vie privée'],
    reponse: "Vos données sont hébergées sur Firebase (Google Cloud). Le contenu d'un dossier est visible par vous et par toute personne disposant du lien ou du QR code associé. Plus de détails dans notre page Confidentialité & Conditions, en bas de l'accueil."
  },
  {
    motsCles: ['mot de passe', 'oublié', 'connexion', 'connecter'],
    reponse: "Sur l'écran de connexion, cliquez sur « Mot de passe oublié ? » après avoir renseigné votre e-mail. Un lien de réinitialisation vous sera envoyé."
  },
  {
    motsCles: ['qr', 'code', 'scanner', 'vérifier', 'vérification'],
    reponse: "Chaque dossier certifié génère un QR code. Scanné par n'importe qui, il ouvre un certificat en lecture seule montrant les détails de l'accord, sans avoir besoin de compte Preuv'."
  },
  {
    motsCles: ['vigilance', 'numéro', 'téléphone', 'signal', 'alerte'],
    reponse: "En renseignant le téléphone de l'autre partie à la création d'un dossier, Preuv' vérifie s'il apparaît dans d'autres dossiers en attente de confirmation ailleurs sur la plateforme. Un signal de prudence avant de vous engager."
  },
  {
    motsCles: ['modifier', 'supprimer', 'changer'],
    reponse: "Dans « Mes dossiers », chaque dossier a des boutons Voir / Modifier / Supprimer. Attention : modifier un dossier régénère une nouvelle empreinte et réinitialise sa confirmation, l'ancienne version restant conservée dans l'historique."
  },
  {
    motsCles: ['pdf', 'exporter', 'imprimer', 'télécharger'],
    reponse: "Le bouton « Exporter en PDF » sur la carte de résultat génère un document propre et imprimable, avec l'en-tête Preuv' et une mention légale, utile à montrer à un médiateur."
  },
  {
    motsCles: ['juridique', 'légal', 'avocat', 'juriste', 'tribunal', 'litige'],
    reponse: "Preuv' renforce la valeur probante d'un accord, mais n'est pas un avis juridique et ne garantit pas l'issue d'un litige. Pour un vrai conseil, rapprochez-vous d'un juriste ou d'un médiateur avec votre certificat en main."
  }
];

function repondreFAQ(question){
  const q = question.toLowerCase();
  let meilleur = null;
  let meilleurScore = 0;
  FAQ.forEach(entry => {
    const score = entry.motsCles.filter(mc => q.includes(mc)).length;
    if (score > meilleurScore){ meilleurScore = score; meilleur = entry; }
  });
  if (meilleur) return meilleur.reponse;
  return "Je n'ai pas de réponse toute prête pour cette question. Écrivez-nous directement à contact.preuvapp@gmail.com, on vous répond rapidement.";
}

function ajouterMessageBot(texte, type){
  const conv = document.getElementById('botConversation');
  const div = document.createElement('div');
  div.className = `bot-msg bot-msg-${type}`;
  div.textContent = texte;
  conv.appendChild(div);
  conv.scrollTop = conv.scrollHeight;
}

document.getElementById('btnOuvrirBot').addEventListener('click', () => {
  document.getElementById('botPanel').classList.remove('hidden');
});
document.getElementById('btnFermerBot').addEventListener('click', () => {
  document.getElementById('botPanel').classList.add('hidden');
});

document.querySelectorAll('.bot-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const q = chip.dataset.q;
    ajouterMessageBot(q, 'user');
    ajouterMessageBot(repondreFAQ(q), 'bot');
  });
});

document.getElementById('botForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('botInput');
  const q = input.value.trim();
  if (!q) return;
  ajouterMessageBot(q, 'user');
  ajouterMessageBot(repondreFAQ(q), 'bot');
  input.value = '';
});

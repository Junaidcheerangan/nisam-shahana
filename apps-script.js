/**
 * ============================================================
 *  WASIM & SARAH — NIKAH INVITATION SYSTEM
 *  Google Apps Script Web App
 * ============================================================
 *
 *  HOW TO SET UP:
 *  1. Open your Google Sheet
 *  2. Click Extensions → Apps Script
 *  3. Delete everything and paste this entire file
 *  4. Click Save (Ctrl+S)
 *  5. Click "Deploy" → "New Deployment"
 *  6. Type: "Web App"  |  Execute as: "Me"  |  Access: "Anyone"
 *  7. Click Deploy → Copy the Web App URL
 *  8. Paste that URL into admin.html and rsvp.html where marked
 * ============================================================
 */

const SHEET_NAME = 'Guests';

// ── Acquire a document-level lock (waits up to 10 s, then throws) ──
function acquireLock() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) {
    throw new Error('Could not acquire lock — too many simultaneous requests. Please try again.');
  }
  return lock;
}

function getOrCreateSheet() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['ID','Name','WhatsApp','Invited At','RSVP Status','Guests Count','Response At']);
    const hdr = sheet.getRange(1,1,1,7);
    hdr.setFontWeight('bold');
    hdr.setBackground('#8b6234');
    hdr.setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidths(1,7,160);
  }
  return sheet;
}

function generateId() {
  return Utilities.getUuid().substring(0,8);
}

function corsResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    const action = e.parameter.action;
    if (action === 'getAll')   return corsResponse(getAllGuests());
    if (action === 'getGuest') return corsResponse(getGuestById(e.parameter.id));
    return corsResponse({ error: 'Unknown action' });
  } catch(err) { return corsResponse({ error: err.message }); }
}

function doPost(e) {
  try {
    const p = JSON.parse(e.postData.contents);
    if (p.action === 'addGuest')    return corsResponse(addGuest(p));
    if (p.action === 'updateGuest') return corsResponse(updateGuest(p));
    if (p.action === 'deleteGuest') return corsResponse(deleteGuest(p));
    if (p.action === 'submitRSVP')  return corsResponse(submitRSVP(p));
    if (p.action === 'bulkAdd')     return corsResponse(bulkAdd(p));
    return corsResponse({ error: 'Unknown action' });
  } catch(err) { return corsResponse({ error: err.message }); }
}

// ── READ ONLY — no lock needed ──

function getAllGuests() {
  const data = getOrCreateSheet().getDataRange().getValues();
  if (data.length <= 1) return { guests: [] };
  return { guests: data.slice(1).map(r => ({
    id: r[0], name: r[1], whatsapp: r[2], invitedAt: r[3],
    rsvpStatus: r[4]||'pending', guestsCount: r[5]||'', responseAt: r[6]||''
  }))};
}

function getGuestById(id) {
  const data = getOrCreateSheet().getDataRange().getValues();
  for (let i=1;i<data.length;i++) {
    if (data[i][0]===id) return { guest: {
      id:data[i][0],name:data[i][1],whatsapp:data[i][2],invitedAt:data[i][3],
      rsvpStatus:data[i][4]||'pending',guestsCount:data[i][5]||'',responseAt:data[i][6]||''
    }};
  }
  return { error:'Guest not found' };
}

// ── WRITE OPERATIONS — all protected by LockService ──

function addGuest(p) {
  const lock = acquireLock();
  try {
    const id = generateId();
    getOrCreateSheet().appendRow([id,p.name,p.whatsapp,new Date().toISOString(),'pending','','']);
    return { success:true, id };
  } finally {
    lock.releaseLock();
  }
}

function updateGuest(p) {
  const lock = acquireLock();
  try {
    const sheet = getOrCreateSheet();
    const data  = sheet.getDataRange().getValues();
    for (let i=1;i<data.length;i++) {
      if (data[i][0]===p.id) {
        if (p.name)     sheet.getRange(i+1,2).setValue(p.name);
        if (p.whatsapp) sheet.getRange(i+1,3).setValue(p.whatsapp);
        return { success:true };
      }
    }
    return { error:'Not found' };
  } finally {
    lock.releaseLock();
  }
}

function deleteGuest(p) {
  const lock = acquireLock();
  try {
    const sheet = getOrCreateSheet();
    const data  = sheet.getDataRange().getValues();
    for (let i=1;i<data.length;i++) {
      if (data[i][0]===p.id) { sheet.deleteRow(i+1); return { success:true }; }
    }
    return { error:'Not found' };
  } finally {
    lock.releaseLock();
  }
}

function submitRSVP(p) {
  const lock = acquireLock();
  try {
    const sheet = getOrCreateSheet();
    const data  = sheet.getDataRange().getValues();
    for (let i=1;i<data.length;i++) {
      if (data[i][0]===p.id) {
        // Write all 3 cells in a single range call (faster, more atomic)
        sheet.getRange(i+1, 5, 1, 3).setValues([[
          p.attending ? 'attending' : 'declined',
          p.guestsCount || 0,
          new Date().toISOString()
        ]]);
        return { success:true };
      }
    }
    return { error:'Not found' };
  } finally {
    lock.releaseLock();
  }
}

function bulkAdd(p) {
  const lock = acquireLock();
  try {
    const sheet  = getOrCreateSheet();
    const now    = new Date().toISOString();
    const guests = p.guests || [];
    if (!guests.length) return { success:true, added:[] };

    const added = [];
    // Build all rows first, then write in ONE batch call (10-20x faster than appendRow loop)
    const rows = guests.map(g => {
      const id = generateId();
      added.push({ id, name: g.name });
      return [id, g.name, g.whatsapp, now, 'pending', '', ''];
    });

    // Find the next empty row and write everything at once
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, rows.length, 7).setValues(rows);

    return { success:true, added };
  } finally {
    lock.releaseLock();
  }
}

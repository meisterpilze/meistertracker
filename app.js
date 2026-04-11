// ══════════════════════════════════════════════════════════════
// Active frontend — uses atomic REST endpoints (apiPost/apiPatch/apiDelete).
// ══════════════════════════════════════════════════════════════

// ─── I18N ────────────────────────────────────────────────────
let currentLang = localStorage.getItem('mp-lang') || 'de';
const LOCALE_MAP = { en: 'en-GB', de: 'de-DE', pt: 'pt-BR' };
function loc() { return LOCALE_MAP[currentLang]; }
function fmtDt(d){if(!(d instanceof Date))d=new Date(d);const dd=String(d.getDate()).padStart(2,'0'),mm=String(d.getMonth()+1).padStart(2,'0'),yy=String(d.getFullYear()).slice(-2);return dd+'.'+mm+'.'+yy}
function fmtDtTime(d){if(!(d instanceof Date))d=new Date(d);return fmtDt(d)+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}
function fmtDtShort(d){if(!(d instanceof Date))d=new Date(d);return String(d.getDate()).padStart(2,'0')+'.'+String(d.getMonth()+1).padStart(2,'0')}
function t(key, params) {
  const str = (LANG[currentLang] && LANG[currentLang][key]) || (LANG['en'] && LANG['en'][key]) || key;
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => params[k] !== undefined ? params[k] : '{'+k+'}');
}
function tp(key, n) { return t(key + (n === 1 ? '.one' : '.other'), { n }); }
function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('mp-lang', lang);
  document.getElementById('lang-sel').value = lang;
  translatePage();
  refresh();
}
function translatePage() {
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.documentElement.lang = currentLang;
}
const LANG = {
  en: {
    // Nav
    'nav.main': 'Main',
    'nav.tools': 'Tools',
    'nav.dashboard': 'Dashboard',
    'nav.batches': 'Batches',
    'nav.lab': 'Lab',
    'nav.inventory': 'Inventory',
    'nav.zones': 'Zones',
    'nav.assets': 'Assets',
    'nav.print': 'Print',
    'nav.strains': 'Pilzsorten',
    'nav.todo': 'To-do',
    'nav.calendar': 'Calendar',
    'strains.manage': 'Manage Pilzsorten',
    'strains.list': 'Existing Pilzsorten',
    'strains.name': 'Name',
    'strains.namePlaceholder': 'e.g. Shiitake',
    'strains.kuerzel': 'Kürzel',
    'strains.kuerzelPlaceholder': 'e.g. SHI',
    'strains.description': 'Description (optional)',
    'strains.save': 'Save Pilzsorte',
    'strains.cancel': 'Cancel',
    'strains.inUse': 'In use',
    'strains.hint': 'Without a Pilzsorte, no batches can be created.',
    'strains.pilzsorte': 'Pilzsorte',
    'strains.selectPlaceholder': '— select Pilzsorte —',
    'strains.noStrainsHint': 'No Pilzsorten defined. Please create one first.',
    'strains.deleteProtected': 'Cannot delete: still in use.',
    'strains.batches': 'batches',
    'strains.cultures': 'cultures',
    'nav.more': 'More',
    // Scan strip
    'scan.placeholder': 'Scan barcode here \u2014 works on every tab...',
    'scan.action': 'Action',
    'scan.from': 'From',
    'scan.to': 'To',
    'scan.count': 'Count',
    'scan.reset': 'Reset',
    'scan.addBatch': 'Add batch',
    'scan.ready': 'Ready \u2014 scan ADD, MOVE, REMOVE or HARVEST to begin',
    'scan.stateReset': 'State reset. Scan ADD, MOVE, REMOVE or HARVEST to begin.',
    // Harvest panel
    'harvest.logHarvest': 'Log harvest',
    'harvest.grams': 'Grams',
    'harvest.flush': 'Flush #',
    'harvest.cancel': 'Cancel',
    'harvest.enterWeight': 'Enter a weight in grams',
    'harvest.cancelled': 'Harvest cancelled.',
    // Dashboard
    'dash.totalBatches': 'Total batches',
    'dash.inIncubation': 'In incubation',
    'dash.inTents': 'In tents / fruiting',
    'dash.totalHarvested': 'Total harvested',
    'dash.alerts': 'Alerts & tasks',
    'dash.seeAll': 'See all',
    'dash.pipeline': 'Production pipeline',
    'dash.harvestBySpecies': 'Harvest by species (kg)',
    'dash.noHarvestData': 'No harvest data yet',
    'dash.liveStatus': 'Live batch status',
    'dash.search': 'Search...',
    'dash.cards': 'Cards',
    'dash.table': 'Table',
    'dash.rackOccupancy': 'Rack occupancy',
    'dash.clickRack': 'Click a rack to see contents',
    'dash.spawnRacks': 'SPAWN \u2014 2 racks',
    'dash.incRacks': 'INC \u2014 10 racks',
    'dash.rack': 'Rack',
    'dash.close': 'Close',
    'dash.bagsByLocation': 'Bags by location',
    'dash.noUrgent': 'No urgent tasks right now.',
    'dash.view': 'View',
    'dash.stock': 'Stock',
    'dash.noMatches': 'No batches match.',
    'dash.noBatches': 'No batches yet. Create one in Batches \u2192 New batch.',
    'dash.noZones': 'No zones configured. Go to Tools \u2192 Zones to add zones.',
    'dash.harvestedAmount': '{g}g harvested',
    'dash.due': 'Due',
    'dash.bags.one': '{n} bag',
    'dash.bags.other': '{n} bags',
    'dash.empty': 'Empty',
    'dash.noBagsOnRack': 'No bags on this rack.',
    'dash.noBagsIn': 'No bags in {loc}.',
    'dash.bagsSelected.one': '{n} bag selected',
    'dash.bagsSelected.other': '{n} bags selected',
    'dash.selectAll': 'Select all',
    'dash.clear': 'Clear',
    'dash.move': 'Move',
    'dash.remove': 'Remove',
    'dash.currentlyIn': 'Currently in {loc}',
    'dash.zones': 'Zones',
    'dash.racks': 'Racks',
    'dash.moveBags': 'Move {n} bag(s)',
    'dash.zoneSpawn': 'Spawn Run',
    'dash.zoneInc': 'Incubation',
    'dash.zoneTent1': 'Tent 1',
    'dash.zoneTent2': 'Tent 2',
    'dash.zoneTent3': 'Tent 3',
    'dash.zoneContam': 'Contaminated',
    'dash.fruitingTents': 'Fruiting Tents',
    'dash.overdue': 'Overdue',
    'dash.harvested': 'Harvested',
    'dash.rackN': 'Rack {n}',
    'dash.legend.title': 'Color guide',
    'dash.legend.species': 'Colored left stripe on batch cards — each species gets its own color so you can spot them at a glance.',
    'dash.legend.zoneDot': 'Zone dot in section headers — shows the color of each location (configured in Tools → Zones).',
    'dash.legend.orangeDot': 'Orange dot in batch tasks — warning, task due soon or needs attention.',
    'dash.legend.redDot': 'Red dot in batch tasks — urgent, overdue or critical action required.',
    'dash.legend.overdue': 'Pink-tinted batch card — batch is overdue (past its due date but still in incubation).',
    'dash.legend.capacity': 'Red capacity bar — location is over its configured maximum capacity.',
    // Status
    'status.INCUBATING': 'INCUBATING',
    'status.FRUITING': 'FRUITING',
    'status.SPAWN_RUN': 'SPAWN RUN',
    'status.CONTAM': 'CONTAM',
    'status.DONE': 'DONE',
    'status.EMPTY': 'EMPTY',
    'status.action.harvest': 'Harvest / check',
    'status.action.moveTent': 'Move to tent when ready',
    'status.action.monitorSpawn': 'Monitor spawn run',
    'status.action.discard': 'Discard bags',
    // Table headers - dashboard
    'th.batchId': 'Batch ID',
    'th.species': 'Species',
    'th.strain': 'Strain',
    'th.total': 'Total',
    'th.harvested': 'Harvested',
    'th.due': 'Due',
    'th.status': 'Status',
    'th.action': 'Action',
    // Bags
    'bags.one': '{n} bag',
    'bags.other': '{n} bags',
    'bags.noBags': 'No bags on this rack.',
    'bags.noBagsIn': 'No bags in {zone}.',
    'bags.selected.one': '{n} bag selected',
    'bags.selected.other': '{n} bags selected',
    'bags.selectAll': 'Select all',
    'bags.clear': 'Clear',
    'bags.move': 'Move',
    'bags.remove': 'Remove',
    'bags.empty': 'Empty',
    'bags.zones': 'Zones',
    'bags.racks': 'Racks',
    'bags.currentlyIn': 'Currently in {loc}',
    'bags.confirm': 'Confirm',
    'bags.undo': 'Undo',
    'bags.undoSuccess': 'Undo successful',
    // Batch page
    'batch.allBatches': 'All batches',
    'batch.newBatch': 'New batch',
    'batch.harvests': 'Harvests',
    'batch.createNew': 'Create new batch',
    'batch.batchType': 'Batch type',
    'batch.fruitingBlock': 'Fruiting block',
    'batch.grainSpawnBag': 'Grain spawn bag',
    'batch.bagWeight': 'Bag weight',
    'batch.qty': 'Qty (bags)',
    'batch.incDays': 'Incubation days',
    'batch.substrate': 'Substrate (optional)',
    'batch.hardwood': 'Hardwood %',
    'batch.wheatBran': 'Wheat bran %',
    'batch.fieldCapacity': 'Field capacity %RH',
    'batch.gypsumAdded': 'Gypsum added',
    'batch.sourceCulture': 'Source culture (optional)',
    'batch.sourceCultureHint': 'Link to the PD or LC used to inoculate this batch',
    'batch.none': '\u2014 none \u2014',
    'batch.notes': 'Notes (optional)',
    'batch.idPreview': 'Batch ID preview',
    'batch.create': 'Create batch',
    'batch.generatedIds': 'Generated bag IDs',
    'batch.printLabels': 'Print labels for this batch',
    'batch.noBatches': 'No batches yet.',
    'batch.noMatches': 'No matches.',
    'batch.addNote': 'Add note',
    'batch.addBags': '+Bags',
    'batch.del': 'Del',
    'batch.moveTo': 'Move to',
    'batch.moveMenuTitle': 'Move {id} to…',
    'batch.noLocations': 'No locations configured',
    'batch.strainLabel': 'Strain',
    'batch.strainPlaceholder': 'e.g. BHA-1, Amazing…',
    'batch.whereGo': 'Where do these bags go?',
    'batch.whereGoInfo': '{id} — {n} bags need a starting location.',
    'batch.zones.rename': 'Rename',
    'batch.zones.renamePrompt': 'New display name for "{old}":',
    'batch.rename': 'Rename ID',
    'batch.renameTitle': 'Rename batch {id}',
    'batch.renameNewId': 'New batch ID',
    'batch.renameWarning': 'All bags, scan log and harvest entries will be updated. This cannot be undone.',
    'batch.renameBtn': 'Rename',
    'batch.renameSuccess': 'Batch renamed: {old} \u2192 {new}',
    'batch.deleteBatch': 'Delete batch {id}?',
    'batch.deleteMsg': 'Permanently deletes the batch record. Scan log and harvest entries remain.',
    'batch.deleteBtn': 'Delete batch',
    'batch.fillFields': 'Please fill in species, strain and quantity',
    'batch.enterWeight': 'Please enter a bag weight',
    'batch.addBagsTo': 'Add bags to batch',
    'batch.grainNeeded': 'Grain needed:',
    'batch.inStock': 'In stock:',
    'batch.sufficient': 'sufficient',
    'batch.onlyEnoughFor': 'only enough for {n} bags',
    'batch.bag': 'Bag:',
    'batch.dryMatterPerBag': 'Total dry matter per bag:',
    'batch.needed': 'needed',
    'batch.shortBy': 'short by',
    // Harvest
    'harvest.totalHarvested': 'Total harvested',
    'harvest.batchesWithYield': 'Batches with yield',
    'harvest.topBatch': 'Top batch',
    'harvest.totalYieldPerBatch': 'Total yield per batch (g)',
    'harvest.overTime': 'Harvest over time (weekly, g)',
    'harvest.perBatchTotals': 'Per batch totals',
    'harvest.log': 'Harvest log',
    'harvest.searchBatch': 'Search batch...',
    'harvest.noHarvests': 'No harvests yet. Scan HARVEST then a bag.',
    'harvest.noData': 'No harvest data yet.',
    'harvest.logged': 'Harvest logged: {bag} \u2192 {g}g (flush {f})',
    'harvest.bagScanned': 'Bag scanned: {bag} \u2192 enter grams above then press Enter',
    // Table headers - harvest
    'th.date': 'Date',
    'th.batch': 'Batch',
    'th.bag': 'Bag',
    'th.flush': 'Flush',
    'th.grams': 'Grams',
    // Table headers - batch list
    'th.qty': 'Qty',
    'th.inc': 'Inc',
    'th.substrate': 'Substrate',
    'th.source': 'Source',
    'th.created': 'Created',
    'th.notes': 'Notes',
    // Lab
    'lab.cultures': 'Cultures',
    'lab.logWork': 'Log work',
    'lab.lineage': 'Lineage',
    'lab.cultureLibrary': 'Culture library',
    'lab.allTypes': 'All types',
    'lab.motherCultures': 'Mother cultures',
    'lab.petriDishes': 'Petri dishes',
    'lab.liquidCultures': 'Liquid cultures',
    'lab.allStatuses': 'All statuses',
    'lab.active': 'Active',
    'lab.stored': 'Stored',
    'lab.usedUp': 'Used up',
    'lab.contaminated': 'Contaminated',
    'lab.deleteCulture': 'Delete culture',
    'lab.deleteCultureTitle': 'Delete culture?',
    'lab.deleteCultureMsg': 'Culture {id} will be permanently deleted. This cannot be undone.',
    'lab.deleteChildren': '{n} child culture(s) reference this culture.',
    'lab.deleteBatches': '{n} batch(es) reference this culture.',
    'lab.deleteRefWarn': 'Their parent/source link will become invalid.',
    'lab.noCultures': 'No cultures yet. Use Lab \u2192 Log work to register them.',
    'lab.logCleanRoom': 'Log clean room work',
    'lab.workType': 'Work type',
    'lab.registerMC': 'Register mother culture',
    'lab.pdTransfer': 'Petri dish transfer',
    'lab.lcPrep': 'Liquid culture prep',
    'lab.g2g': 'Grain-to-grain (G2G)',
    'lab.parentCulture': 'Parent culture',
    'lab.parentMCPDLC': 'Parent (MC, PD or LC)',
    'lab.sourcePDMC': 'Source (petri dish or MC)',
    'lab.noneNewIsolation': '\u2014 none / new isolation \u2014',
    'lab.source': 'Source (e.g. clone, spore print, wild)',
    'lab.qtyMade': 'Quantity made',
    'lab.qtyTubes': 'Quantity (tubes/dishes)',
    'lab.numDishes': 'Number of dishes',
    'lab.numFlasks': 'Number of flasks',
    'lab.numBags': 'Number of bags',
    'lab.observations': 'Observations, conditions...',
    'lab.idsCreated': 'IDs that will be created',
    'lab.logWorkBtn': 'Log work',
    'lab.recentEntries': 'Recent lab entries',
    'lab.noWork': 'No lab work logged yet.',
    'lab.enterSpecies': 'Please enter a species',
    'lab.selectPilzsorte': 'Please select a Pilzsorte',
    'lab.g2gNote': 'G2G is recorded via the scan bar \u2014 use ADD to move grain bags.',
    'lab.printNow': 'Print labels now?',
    'lab.qtyDishes': 'Number of dishes',
    'lab.qtyFlasks': 'Number of flasks',
    'lab.qtyBags': 'Number of bags',
    'lab.parentMcPdLc': 'Parent (MC, PD or LC)',
    'lab.sourcePdMc': 'Source (petri dish or MC)',
    'lab.logged': 'Logged: {n} {type} created',
    'lab.noLabWork': 'No lab work logged yet.',
    'lab.geneticLineage': 'Genetic lineage',
    'lab.selectCultureBatch': '\u2014 select a culture or batch \u2014',
    'lab.selectAbove': 'Select a culture or batch above to trace its lineage.',
    'lab.selectAboveShort': 'Select a culture or batch above.',
    'lab.noLineageData': 'No lineage data found.',
    'lab.grainSpawn': 'Grain spawn',
    'lab.createGrainSpawn': 'Create grain spawn bags',
    'lab.grainIdPreview': 'Grain spawn ID preview',
    'lab.createGrainBtn': 'Create grain spawn',
    'lab.grainCreated': '{n} grain spawn bags created',
    // Table headers - lab
    'th.id': 'ID',
    'th.type': 'Type',
    'th.parent': 'Parent',
    // Print
    'print.printerInfo': 'Printing directly to ZDesigner GK420d',
    'print.printerInfoDetail': 'via the server \u2014 no dialog needed. Make sure the server is running and the printer is on.',
    'print.bagLabels': 'Bag labels',
    'print.labLabels': 'Lab labels',
    'print.refBarcodes': 'Reference barcodes',
    'print.selectBatch': 'Select batch',
    'print.chooseBatch': '\u2014 choose batch \u2014',
    'print.labelContent': 'Label content',
    'print.barcodeIdOnly': 'Barcode + ID only',
    'print.barcodeIdSpecies': 'Barcode + ID + strain/substrate',
    'print.barcodeIdDate': 'Barcode + ID + strain/substrate + due date',
    'print.printRange': 'Print range',
    'print.allBags': 'All bags',
    'print.bagRange': 'Bag range (from\u2013to)',
    'print.printDirect': 'Print labels (direct)',
    'print.preview': 'Preview',
    'print.selectBatchAbove': 'Select a batch above.',
    'print.filterCultures': 'Filter cultures',
    'print.allActiveCultures': 'All active cultures',
    'print.createdToday': 'Created today',
    'print.labelIncludes': 'Label includes',
    'print.code128barcode': 'Code 128 barcode',
    'print.qrCode': 'QR code',
    'print.speciesStrain': 'Species + strain',
    'print.parentId': 'Parent ID',
    'print.dateCreated': 'Date created',
    'print.printLabDirect': 'Print labels (direct)',
    'print.noCultureMatch': 'No cultures match.',
    'print.tickCultures': 'Tick cultures in the list to preview labels.',
    'print.refBarcodesTitle': 'Reference barcodes \u2014 print & hang on wall',
    'print.qrCodes': 'QR codes',
    'print.printSheet': 'Print sheet',
    'print.scanInfo': 'Scanning works on every tab \u2014 just scan from this sheet at any time.',
    'print.selectBatchFirst': 'Select a batch first.',
    'print.noBagsInRange': 'No bags in that range.',
    'print.selectCulture': 'Select at least one culture.',
    // To-do
    'todo.tasks': 'Tasks',
    'todo.team': 'Team',
    'todo.calendar': 'Calendar',
    'todo.batchTasks': 'Batch tasks',
    'todo.all': 'All',
    'todo.urgentOnly': 'Urgent only',
    'todo.manualTasks': 'Manual tasks',
    'todo.add': '+ Add',
    'todo.task': 'Task',
    'todo.priority': 'Priority',
    'todo.low': 'Low',
    'todo.medium': 'Medium',
    'todo.high': 'High',
    'todo.assignTo': 'Assign to',
    'todo.everyone': 'Everyone (company)',
    'todo.dueDate': 'Due date (optional)',
    'todo.description': 'Description (optional)',
    'todo.save': 'Save',
    'todo.openTasks': 'Open tasks',
    'todo.urgent': 'Urgent',
    'todo.comingUp': 'Coming up',
    'todo.noTasks': 'No tasks right now!',
    'todo.noManualTasks': 'No manual tasks.',
    'todo.dueAgo': 'Due {n} day(s) ago',
    'todo.dueIn': 'Due in {n} day(s)',
    'todo.fruiting': 'fruiting',
    'todo.deleteTask': 'Delete task?',
    'todo.deleteTaskMsg': 'This task will be permanently removed.',
    'todo.delete': 'Delete',
    'todo.everyone_tag': 'Everyone',
    // Days
    'days.ago.one': 'Due {n} day ago',
    'days.ago.other': 'Due {n} days ago',
    'days.in.one': 'Due in {n} day',
    'days.in.other': 'Due in {n} days',
    'days.inDays': 'Due in {n} days',
    // Team
    'team.members': 'Team members',
    'team.membersDesc': 'Add team members so you can assign tasks to individuals. Each member can optionally get their own synced CalDAV calendar.',
    'team.noMembers': 'No team members yet. Add your first member below.',
    'team.name': 'Name',
    'team.role': 'Role (optional)',
    'team.addMember': '+ Add member',
    'team.removeMember': 'Remove member?',
    'team.removeMsg': 'Remove {name} from the team. Their existing task assignments remain.',
    'team.removeBtn': 'Remove',
    // CalDAV
    'caldav.title': 'CalDAV calendar server',
    'caldav.desc': 'This server includes a built-in CalDAV server. Connect any calendar app (Apple Calendar, Thunderbird, DAVx5 on Android) to see your tasks.',
    'caldav.urlTitle': 'CalDAV URL (use this in your calendar app)',
    'caldav.password': 'Optional: protect with password',
    'caldav.username': 'Username',
    'caldav.userPlaceholder': 'leave empty for open access',
    'caldav.passPlaceholder': 'leave empty for open access',
    'caldav.enableSync': 'Enable sync (push tasks to calendars)',
    'caldav.perPerson': 'Separate calendar per person',
    'caldav.saveSettings': 'Save settings',
    'caldav.syncNow': 'Sync all tasks now',
    'caldav.settingsSaved': 'Settings saved.',
    'caldav.enableFirst': 'Enable sync first, then save settings.',
    'caldav.syncing': 'Syncing...',
    'caldav.writingTasks': 'Writing tasks to calendar files...',
    'caldav.howToConnect': 'How to connect',
    'caldav.howItWorks': 'How it works',
    // More / Settings
    'settings.scanLog': 'Scan log',
    'settings.user': 'User',
    'settings.backup': 'Backup',
    'settings.clear': 'Clear',
    'settings.noScans': 'No scans yet.',
    'settings.clearLog': 'Clear entire scan log?',
    'settings.clearLogMsg': 'Permanently deletes all {n} scan entries. Batches and harvests are not deleted.',
    'settings.clearLogBtn': 'Yes, clear everything',
    'settings.downloadBackupTitle': 'Download backup',
    'settings.downloadBackupDesc': 'Download a password-encrypted full backup. Save to USB, cloud or email it to yourself.',
    'settings.downloadBackupBtn': 'Download backup',
    'settings.restoreBackupTitle': 'Restore backup',
    'settings.restoreDescHtml': 'Restore from an encrypted backup file. <strong style="color:var(--c-red-dark)">Replaces all current data for everyone.</strong>',
    'settings.restoreBtn': 'Restore',
    'settings.syncInfo': 'Sync info',
    'settings.syncInfoDesc': 'All data is stored on the server \u2014 shared by all devices automatically. Changes sync every 5 seconds. Click the green dot in the top bar to sync immediately.',
    'settings.restoreBackup': 'Restore this backup?',
    'settings.restoreMsg': 'Replaces ALL data on the server for all users. Cannot be undone.',
    'settings.restoreConfirm': 'Yes, restore',
    'settings.invalidFile': 'Invalid file.',
    'settings.cannotRead': 'Cannot read file.',
    // Table headers - scan log
    'th.time': 'Time',
    // Sync
    'sync.syncing': 'Syncing...',
    'sync.synced': 'Synced {time}',
    'sync.saving': 'Saving...',
    'sync.saved': 'Saved {time}',
    'sync.error': 'Sync error',
    'sync.saveError': 'Save error \u2014 check server is running',
    'sync.clickToSync': 'Click to sync',
    // Inventory
    'inv.stock': 'Stock',
    'inv.logDelivery': 'Log delivery',
    'inv.usageLog': 'Usage log',
    'inv.alertThresholds': 'Alert thresholds',
    'inv.alertThresholdsDesc': 'Set the minimum stock level that triggers a low-stock warning. Also set the standard bag size used to calculate "enough for X bags".',
    'inv.lowStock': 'LOW STOCK',
    'inv.alertBelow': 'Alert below {n}kg',
    'inv.logDeliveryBtn': '+ Log delivery',
    'inv.logIncoming': 'Log incoming delivery',
    'inv.material': 'Material',
    'inv.currentStock': 'Current stock: {n} kg',
    'inv.amountReceived': 'Amount received (kg)',
    'inv.supplierNote': 'Supplier / note (optional)',
    'inv.addToStock': 'Add to stock',
    'inv.afterDelivery': 'After delivery:',
    'inv.manualAdj': 'Manual adjustment',
    'inv.manualAdjDesc': 'Use this to correct stock after a physical count, spoilage, or any discrepancy.',
    'inv.setStockTo': 'Set stock to (kg)',
    'inv.orAddSubtract': 'or add / subtract',
    'inv.adjustBy': 'Adjust by (kg) \u2014 negative to subtract',
    'inv.reason': 'Reason',
    'inv.apply': 'Apply',
    'inv.usageHistory': 'Material usage history',
    'inv.allMaterials': 'All materials',
    'inv.noUsageHistory': 'No usage history yet.',
    'inv.enterQty': 'Enter a quantity greater than 0',
    'inv.enterAmount': 'Enter either a new total or an adjustment amount',
    'inv.grainBags': '\u2248 {n} grain bags @ {kg}kg each',
    'inv.blocks': '\u2248 <strong>{n}</strong> \u00d7 {kg}kg blocks <span style="font-size:10px;color:var(--c-text-muted)">(avg estimate)</span>',
    'inv.avgComposition': 'Average composition used for estimates',
    'inv.avgCompDesc': 'These averages are used to calculate "\u007eX bags" on the stock cards. They are <strong>estimates only</strong> \u2014 exact usage is tracked when you create a batch with a specific substrate recipe.',
    'inv.hardwoodPct': 'Hardwood %',
    'inv.wheatBranPct': 'Wheat bran %',
    'inv.waterPct': 'Water % (RH)',
    'inv.blockWeight': 'Block weight (kg)',
    'inv.grainBagKg': 'Grain bag (kg)',
    'inv.lowStockAlert': 'Low stock: {mat}',
    // Material labels
    'mat.hardwood': 'Hardwood pellets',
    'mat.wheatbran': 'Wheat bran',
    'mat.gypsum': 'Gypsum',
    'mat.grain': 'Grain',
    // Table headers - inventory
    'th.material': 'Material',
    'th.inStock': 'In stock',
    'th.alertBelow': 'Alert below (kg)',
    'th.estBags': 'Est. bags (avg)',
    // Assets
    'assets.overview': 'Overview',
    'assets.add': 'Add',
    'assets.labels': 'Labels',
    'assets.export': 'Export',
    'assets.title': 'Asset inventory',
    'assets.name': 'Name',
    'assets.category': 'Category',
    'assets.purchasePrice': 'Purchase price',
    'assets.bookValue': 'Book value',
    'assets.location': 'Location',
    'assets.actions': 'Actions',
    'assets.total': 'Total',
    'assets.purchaseValueActive': 'Purchase value (active)',
    'assets.bookValueToday': 'Book value today (active)',
    'assets.noAssets': 'No assets recorded. Click "Add" to get started.',
    'assets.edit': 'Edit',
    'assets.print': 'Print',
    'assets.addAsset': 'Add asset',
    'assets.entryDate': 'Entry date',
    'assets.usefulLife': 'Useful life (years)',
    'assets.depMethod': 'Depreciation method',
    'assets.linear': 'Linear',
    'assets.supplier': 'Supplier',
    'assets.invoiceNr': 'Invoice number',
    'assets.serialNr': 'Serial number',
    'assets.exitDate': 'Exit date',
    'assets.saveBtn': 'Save',
    'assets.resetBtn': 'Reset',
    'assets.newId': 'New ID: {id}',
    'assets.editing': 'Editing: {id}',
    'assets.fillRequired': 'Please fill in all required fields.',
    'assets.deleteAsset': 'Delete asset?',
    'assets.deleteMsg': 'Asset {id} will be permanently deleted.',
    'assets.deleteBtn': 'Yes, delete',
    'assets.csvExport': 'CSV Export',
    'assets.csvDesc': 'Complete inventory list with all fields and calculated depreciation values as CSV for the tax advisor.',
    'assets.exportCsv': 'Export CSV',
    'assets.cutoffInv': 'Cut-off date inventory',
    'assets.cutoffDate': 'Cut-off date',
    'assets.calculate': 'Calculate',
    'assets.chooseCutoff': 'Please choose a cut-off date.',
    'assets.printLabels': 'Print inventory labels',
    'assets.all': 'All',
    'assets.none': 'None',
    'assets.printBtn': 'Print',
    'assets.downloadZPL': 'Download ZPL',
    'assets.noAssetsAvail': 'No assets available.',
    'assets.selectAsset': 'Please select at least one asset.',
    'assets.printError': 'Print error: ',
    // Asset categories
    'assets.cat.Maschinen': 'Machinery',
    'assets.cat.Büroausstattung': 'Office equipment',
    'assets.cat.EDV': 'IT equipment',
    'assets.cat.Labor': 'Laboratory',
    'assets.cat.Fahrzeuge': 'Vehicles',
    'assets.cat.Sonstiges': 'Other',
    // Asset statuses
    'assets.status.aktiv': 'Active',
    'assets.status.ausgeschieden': 'Retired',
    'assets.status.verkauft': 'Sold',
    'assets.status.verschrottet': 'Scrapped',
    // CSV headers
    'csv.invNr': 'Asset-Nr',
    'csv.name': 'Name',
    'csv.category': 'Category',
    'csv.entryDate': 'Entry date',
    'csv.purchaseCost': 'Purchase cost',
    'csv.usefulLife': 'Useful life (y.)',
    'csv.annualDepr': 'Annual depr.',
    'csv.accumDepr': 'Accum. depr.',
    'csv.bookValue': 'Book value',
    'csv.gwg': 'GWG',
    'csv.status': 'Status',
    'csv.supplier': 'Supplier',
    'csv.invoiceNr': 'Invoice nr.',
    'csv.serialNr': 'Serial nr.',
    'csv.location': 'Location',
    'csv.exitDate': 'Exit date',
    'csv.remarks': 'Remarks',
    'csv.yes': 'Yes',
    'csv.no': 'No',
    // Cutoff report
    'cutoff.date': 'Cut-off: {date} \u2014 {n} active assets',
    'cutoff.nr': 'Nr',
    'cutoff.purchaseCost': 'Purchase cost',
    'cutoff.accumDepr': 'Accum. depr.',
    'cutoff.sum': 'Sum',
    // Bag info modal
    'bagInfo.currentLocation': 'Current location',
    'bagInfo.notPlaced': 'Not placed yet',
    'bagInfo.removed': 'Removed',
    'bagInfo.noneYet': 'None yet',
    'bagInfo.allBags': 'all bags',
    'bagInfo.addThisBag': '+ ADD this bag',
    'bagInfo.moveThisBag': 'Move MOVE this bag',
    'bagInfo.harvestThisBag': 'Harvest HARVEST this bag',
    'bagInfo.removeThisBag': 'X REMOVE this bag',
    // Confirm modal
    'confirm.confirm': 'Confirm',
    'confirm.cancel': 'Cancel',
    // Note modal
    'note.title': 'Note \u2014 {id}',
    'note.save': 'Save',
    'note.cancel': 'Cancel',
    // Scan feedback
    'scanFb.actionAdd': 'Action: ADD \u2192 scan location or rack, then bags',
    'scanFb.actionMove': 'Action: MOVE \u2192 scan destination location, then bags',
    'scanFb.actionRemove': 'Action: REMOVE \u2192 scan bags',
    'scanFb.actionHarvest': 'Action: HARVEST \u2192 scan a bag to log its weight',
    'scanFb.location': 'Location: {loc} \u2192 now scan bags (location stays until you change it)',
    'scanFb.from': 'From: {loc} \u2192 scan the TO location',
    'scanFb.to': 'To: {loc} \u2192 now scan bags',
    'scanFb.setAction': 'Set an action first \u2014 scan ADD, MOVE, REMOVE or HARVEST.',
    'scanFb.scanLocFirst': 'Scan a location or rack first.',
    'scanFb.scanFromTo': 'Scan FROM and TO locations first.',
    'scanFb.scanToFirst': 'Scan the destination location first.',
    'scanFb.logged': 'Logged: {action} {val}{to} [{n} this session]',
    'scanFb.bagNotPlaced': '{bag} has no known location \u2014 use ADD first',
    'scanFb.bagRemoved': '{bag} was removed \u2014 use ADD to place it again',
    'scanFb.bagAlreadyAt': '{bag} is already at {loc}',
    'scanFb.unknown': 'Unknown barcode: {val}. Check the batch exists first.',
    'scanFb.unknownFormat': 'Unknown format: {val} — check barcode.',
    'scanFb.matched': 'Matched: {val} from {batch}',
    'scanFb.noBatchFound': 'No batch found for {val} \u2014 check species/strain/date match',
    'scanFb.removeLogged': 'REMOVE logged: {bag}',
    'scanFb.actionReady': '{action} ready \u2014 now scan a location, then scan more bags',
    'scanFb.bagInfo': 'Bag info: {bag} \u2014 choose an action below or close',
    'scanFb.cultureScanned': 'Culture scanned: {val} \u2192 lineage view',
    'scanFb.moved': 'Moved {n} \u2192 {loc}',
    'scanFb.removed': 'Removed {n}',
    'scanFb.confirmRemove': 'Remove {n}?',
    // Batch add modal
    'batchAdd.title': 'Add bags to batch',
    'batchAdd.willLog': 'Will log {n} bags \u2192 {loc}',
    'batchAdd.selectFirst': 'Select a batch first',
    'batchAdd.batchAdd': 'Batch ADD: {n} bags \u2192 {loc}',
    // Add bags modal
    'addBags.title': 'Add bags',
    'addBags.info': '{id} currently has {n} bags ({last} is last)',
    'addBags.enterQty': 'Enter at least 1',
    'addBags.added': 'Added {qty} to {id} (now {total} total)',
    'addBags.addedTitle': 'Bags added',
    'addBags.howMany': 'How many bags to add',
    'addBags.printLabels': 'Print labels',
    'addBags.printed': '{n} labels printed for {id}',
    'addBags.close': 'Close',
    // Delivery/adjustment feedback
    'inv.deliveryLogged': 'Delivery logged: +{kg}kg {mat} now {total}kg total',
    'inv.adjusted': 'Adjusted {mat}: {delta}kg now {total}kg total',
    'inv.suppliers': 'Suppliers',
    'inv.suppliersDesc': 'Manage suppliers for each material so you know where to reorder.',
    'inv.addSupplier': 'Add supplier',
    'inv.supplierName': 'Name',
    'inv.supplierUrl': 'Website',
    'inv.supplierPhone': 'Phone',
    'inv.supplierNotes': 'Notes',
    'inv.noSuppliers': 'No suppliers added yet.',
    'inv.reorderFrom': 'Reorder from',
    'inv.editSupplier': 'Edit',
    'inv.deleteSupplier': 'Delete',
    'inv.supplierSaved': 'Supplier saved',
    'inv.supplierDeleted': 'Supplier deleted',
    // Print feedback
    'print.printed': 'Printed {n} labels for {id}',
    'print.printedLabels': 'Printed {n} lab label(s)',
    'print.assetLabelsPrinted.one': '{n} inventory label printed',
    'print.assetLabelsPrinted.other': '{n} inventory labels printed',
    // CalDAV feedback
    'caldav.done': 'Done! {n} tasks written to calendar.{errors} Calendar clients can now see them via CalDAV.',
    'caldav.syncFail': 'Sync failed: {err}',
    'caldav.syncError': 'Sync error: {err}',
    // Backup validation
    'settings.valid': 'Valid: {date} \u2014 {batches} batches, {scans} scans, {cultures} cultures, inventory: {inv}.',
    // Static HTML keys
    'batch.batchId': 'Batch ID',
    'batch.species': 'Species',
    'batch.strain': 'Strain',
    'batch.notFound': 'Batch not found',
    'nav.cancel': 'Cancel',
    'settings.time': 'Time',
    'settings.action': 'Action',
    'settings.bag': 'Bag',
    'settings.from': 'From',
    'settings.to': 'To',
    'settings.restoreDescHtml': 'Restore from an encrypted backup file. <strong style="color:var(--c-red-dark)">Replaces all current data for everyone.</strong>',
    'mcp.title': 'MCP Server',
    'mcp.desc': 'Allows Claude and other AI assistants to access the MeisterTracker database via the Model Context Protocol. Claude connects automatically via OAuth \u2014 just paste the URL.',
    'mcp.enable': 'Enable MCP server',
    'mcp.connectorUrl': 'Connector URL',
    'mcp.copy': 'Copy',
    'mcp.apiKey': 'API Key (scripts / automation)',
    'mcp.generateKey': 'Generate API key',
    'mcp.keyHint': 'For scripts or tools that cannot use OAuth. Use as Bearer token in the Authorization header. The key is only shown once.',
    'mcp.save': 'Save',
    'mcp.active': 'MCP server active',
    'mcp.noKey': 'MCP enabled \u2014 ready to connect via OAuth.',
    'mcp.sessions': 'MCP server active \u2014 {n} session(s)',
    'mcp.urlCopied': 'URL copied!',
    'mcp.keyCopied': 'Key copied!',
    'mcp.keyGenerated': 'API key generated. Copy it now!',
    'mcp.saved': 'Settings saved.',
    'mcp.error': 'Error: {msg}',
    'mcp.guideTitle': 'Setup guide',
    'mcp.diagTitle': 'Diagnostics',
    'mcp.runDiag': 'Run Diagnostics',
    'mcp.diagRunning': 'Running diagnostics...',
    'mcp.diagFailed': 'Failed to run diagnostics',
    'mcp.diagAutoClients': 'Auto-registered clients',
    'mcp.diagManualClients': 'Manual clients',
    'mcp.diagSessions': 'Active MCP sessions',
    'mcp.oauthTitle': 'Connected Clients',
    'mcp.oauthDesc': 'Clients that connected via OAuth. Claude registers automatically when you add the connector URL.',
    'mcp.noClients': 'No connected clients yet. Connect Claude by pasting the URL above.',
    'mcp.clientName': 'Name',
    'mcp.unnamed': '(unnamed)',
    'mcp.created': 'Created',
    'mcp.activeSessions': 'Sessions',
    'mcp.deleteClient': 'Delete',
    'mcp.confirmDelete': 'Delete this client? All its active sessions will be revoked.',
    'mcp.confirmDeleteAuto': 'Revoke this auto-registered client? Claude will register a new client on its next connection.',
    'mcp.clientDeleted': 'Client deleted.',
    'mcp.step1': '1. Enable MCP server and save',
    'mcp.step2': '2. Copy the connector URL above',
    'mcp.step3': '3. In Claude: Settings \u2192 Connectors \u2192 Add \u2192 paste the URL',
    'mcp.step4': '4. Log in when prompted \u2014 done! Claude connects automatically via OAuth.',
    'mcp.features': 'Available features: Daily briefing, manage batches, tasks, calendar, inventory, harvests, cultures, zone overview',
    'todo.taskPlaceholder': 'e.g. Clean humidity tent',
    'todo.descPlaceholder': 'Additional details...',
    'inv.hardwood': 'Hardwood pellets',
    'inv.wheatBran': 'Wheat bran',
    'inv.gypsum': 'Gypsum',
    'inv.grain': 'Grain',
    'inv.date': 'Date',
    'inv.changeKg': 'Change (kg)',
    'inv.runningTotal': 'Running total',
    'inv.type': 'Type',
    'inv.reference': 'Reference',
    'asset.overview': 'Overview',
    'asset.addNew': 'Add',
    'asset.export': 'Export',
    'asset.labels': 'Labels',
    'asset.inventory': 'Asset inventory',
    'asset.allCategories': 'All categories',
    'asset.allStatus': 'All status',
    'asset.cat.machinery': 'Machinery',
    'asset.cat.office': 'Office equipment',
    'asset.cat.it': 'IT equipment',
    'asset.cat.lab': 'Laboratory',
    'asset.cat.vehicles': 'Vehicles',
    'asset.cat.other': 'Other',
    'asset.status.aktiv': 'Active',
    'asset.status.ausgeschieden': 'Retired',
    'asset.status.verkauft': 'Sold',
    'asset.status.verschrottet': 'Scrapped',
    'asset.nr': 'Nr',
    'asset.name': 'Name',
    'asset.category': 'Category',
    'asset.purchasePrice': 'Purchase price',
    'asset.bookValue': 'Book value',
    'asset.status': 'Status',
    'asset.location': 'Location',
    'asset.actions': 'Actions',
    'asset.recordAsset': 'Record asset',
    'asset.designation': 'Designation *',
    'asset.designationPh': 'e.g. Autoclave 50L',
    'asset.acquisitionDate': 'Acquisition date *',
    'asset.netPrice': 'Purchase price (\u20ac net) *',
    'asset.usefulLife': 'Useful life (years) *',
    'asset.deprMethod': 'Depreciation method',
    'asset.linear': 'Linear',
    'asset.supplier': 'Supplier',
    'asset.supplierPh': 'Company name',
    'asset.invoiceNr': 'Invoice number',
    'asset.serialNr': 'Serial number',
    'asset.locationPh': 'e.g. Lab, Office',
    'asset.exitDate': 'Exit date',
    'asset.notes': 'Notes',
    'asset.save': 'Save',
    'asset.reset': 'Reset',
    'asset.csvExport': 'CSV Export',
    'asset.csvExportDesc': 'Complete inventory list with all fields and calculated depreciation values as CSV for the tax advisor.',
    'asset.exportCsv': 'Export CSV',
    'asset.cutoffInventory': 'Cut-off date inventory',
    'asset.cutoffDate': 'Cut-off date',
    'asset.calculate': 'Calculate',
    'asset.printLabels': 'Print inventory labels',
    'asset.selectAll': 'All',
    'asset.selectNone': 'None',
    'asset.print': 'Print',
    'asset.downloadZpl': 'Download ZPL',
    // Zones
    'zones.title': 'Zones & Racks',
    'zones.desc': 'Manage your farm locations. Zones can only be deleted when empty.',
    'zones.addTitle': 'Add zone',
    'zones.zoneName': 'Name',
    'zones.zoneRole': 'Role',
    'zones.zoneColor': 'Color',
    'zones.zoneRacks': 'Racks (optional, comma-separated)',
    'zones.add': 'Add zone',
    'zones.delete': 'Delete',
    'zones.deleteTitle': 'Delete zone?',
    'zones.deleteMsg': 'Zone "{name}" and all its racks will be removed.',
    'zones.noRacks': 'No racks',
    'zones.rackPrompt': 'Rack name (e.g. R3):',
    'zones.errShort': 'Zone name too short (min. 2 chars)',
    'zones.errExists': 'Zone already exists',
    'zones.errRackExists': 'Rack already exists',
    'zones.empty': 'No zones configured.',
    'zones.roleSpawn': 'Spawn',
    'zones.roleIncubation': 'Incubation',
    'zones.roleFruiting': 'Fruiting',
    'zones.roleContaminated': 'Contaminated',
    'zones.errIdStart': 'Zone name must start with a letter (A-Z)',
    'zones.errLong': 'Zone name too long (max. 50 chars)',
    'zones.errRackEmpty': 'Rack name cannot be empty',
    'zones.errTooManyRacks': 'Too many racks (max. 50)',
    'zones.hasBags': '{count} bags — remove first',
    'zones.directBags': '{count} not in rack',
    'zones.directBagsHint': 'These bags were scanned to the zone, not a specific rack. Move them to a rack for accurate tracking.',
    'zones.dragToReorder': 'Drag to reorder',
    'zones.edit': 'Edit',
    'zones.editTitle': 'Edit Zone',
    'zones.moveToRack': 'Move to rack',
    'zones.moveToRackTitle': 'Move {count} bags to a rack',
    'zones.movedToRack': '{count} bags moved to {rack}',
    'zones.addRack': '+ Rack',
    'zones.rackDeleteTitle': 'Delete rack?',
    'zones.rackDeleteMsg': 'Rack "{name}" will be removed.',
    'zones.showQr': 'Show QR',
    'zones.hideQr': 'Hide QR',
    'zones.printQr': 'Print QR',
    'zones.printAllQr': 'Print all QR codes',
    'zones.capacity': 'Max. capacity (bags)',
    'zones.errCapacity': 'Capacity must be a positive number',
    'scanFb.preferRack': '⚠ "{loc}" is a zone — scan a rack for precise tracking (e.g. {example})',
    // Calendar entry modal
    'calEntry.titleNew': 'New entry',
    'calEntry.titleEdit': 'Edit entry',
    'calEntry.name': 'Title',
    'calEntry.namePhTask': 'e.g. Clean humidity tent',
    'calEntry.namePhEvent': 'e.g. Team meeting',
    'calEntry.category': 'Category',
    'calEntry.cat.task': 'Task',
    'calEntry.cat.custom': 'Custom event',
    'calEntry.cat.meeting': 'Meeting',
    'calEntry.cat.delivery': 'Delivery',
    'calEntry.cat.maintenance': 'Maintenance',
    'calEntry.prio': 'Priority',
    'calEntry.prio.low': 'Low',
    'calEntry.prio.med': 'Medium',
    'calEntry.prio.high': 'High',
    'calEntry.date': 'Date',
    'calEntry.endDate': 'Until (optional)',
    'calEntry.allDay': 'All day',
    'calEntry.from': 'From',
    'calEntry.to': 'To',
    'calEntry.recurrence': 'Repeat',
    'calEntry.rec.none': 'None',
    'calEntry.rec.daily': 'Daily',
    'calEntry.rec.weekly': 'Weekly',
    'calEntry.rec.monthly': 'Monthly',
    'calEntry.recurrenceUntil': 'Repeat until (optional)',
    'calEntry.desc': 'Description (optional)',
    'calEntry.descPh': 'Details...',
    'calEntry.assignTo': 'Assign to',
    'calEntry.assignTo.all': 'Everyone (company)',
    'calEntry.assignedTo': 'Assigned to',
    'calEntry.allClickToSelect': 'Everyone (click to select)',
    'calEntry.noMembers': 'No team members yet. Add them in the Team tab first.',
    'calEntry.private': 'Only visible to the assigned person',
    'calEntry.cancel': 'Cancel',
    'calEntry.save': 'Save',
    'calEntry.delete': 'Delete',
    'calEntry.deleteTask': 'Delete task?',
    'calEntry.deleteEvent': 'Delete event?',
    'calEntry.deleteTaskMsg': 'This task will be permanently removed.',
    'calEntry.deleteEventMsg': 'This event will be permanently removed.',
    // Calendar views
    'cal.allDay': 'All day',
    'cal.allDayShort': 'All-d.',
    'cal.noAllDay': 'No all-day events',
    'cal.more': 'more',
    'cal.title': 'Calendar',
    'cal.monthView': 'Month view',
    'cal.weekView': 'Week view',
    'cal.dayView': 'Day view',
    'cal.printed': 'printed on',
    'cal.legend.batches': 'Due dates',
    'cal.legend.tasks': 'Tasks',
    'cal.legend.harvests': 'Harvests',
    'cal.legend.custom': 'Custom events',
    'cal.legend.meetings': 'Meetings',
    'cal.legend.deliveries': 'Deliveries',
    'cal.legend.maintenance': 'Maintenance',
    'cal.legend.external': 'External events',
    'cal.days': 'Mo,Tu,We,Th,Fr,Sa,Su',
    'cal.months': 'January,February,March,April,May,June,July,August,September,October,November,December',
    'calEntry.moveTitle': 'Move entry',
    'calDetail.close': 'Close',
    'calDetail.edit': 'Edit',
    'calDetail.assignedTo': 'Assigned to',
    'calDetail.everyone': 'Everyone',
    'calDetail.taskDue': 'Task',
    'calDetail.dueLabel': 'Due',
    'calDetail.markDone': 'Mark as done',
    'calDetail.markUndone': 'Mark as not done',
    'calDetail.batchDue': 'Batch due',
    'calDetail.harvest': 'Harvest',
    'calDetail.external': 'External event',
    'calEntry.until': 'until',
    'cal.monthShort': 'Month',
    'cal.weekShort': 'Week',
    'cal.dayShort': 'Day',
    'cal.printTitle': 'Print calendar',
    'cal.newEntry': '+ New',
    'cal.taskListTitle': 'Task list',
    'cal.entries': 'entries',
    'cal.noTasks': 'no tasks',
    'cal.printChooseRange': 'Choose the range for the task list:',
    'cal.printWeek': 'Week — task list for the current week',
    'cal.printMonth': 'Month — task list for the current month',
  },
  de: {
    // Nav
    'nav.main': 'Hauptmenü',
    'nav.tools': 'Werkzeuge',
    'nav.dashboard': 'Dashboard',
    'nav.batches': 'Chargen',
    'nav.lab': 'Labor',
    'nav.inventory': 'Lager',
    'nav.zones': 'Zonen',
    'nav.assets': 'Anlagen',
    'nav.print': 'Drucken',
    'nav.strains': 'Pilzsorten',
    'nav.todo': 'Aufgaben',
    'nav.calendar': 'Kalender',
    'strains.manage': 'Pilzsorten verwalten',
    'strains.list': 'Vorhandene Pilzsorten',
    'strains.name': 'Name',
    'strains.namePlaceholder': 'z. B. Shiitake',
    'strains.kuerzel': 'Kürzel',
    'strains.kuerzelPlaceholder': 'z. B. SHI',
    'strains.description': 'Beschreibung (optional)',
    'strains.save': 'Pilzsorte anlegen',
    'strains.cancel': 'Abbrechen',
    'strains.inUse': 'Verwendung',
    'strains.hint': 'Ohne angelegte Pilzsorte können keine Chargen erstellt werden.',
    'strains.pilzsorte': 'Pilzsorte',
    'strains.selectPlaceholder': '— Pilzsorte wählen —',
    'strains.noStrainsHint': 'Keine Pilzsorten angelegt. Bitte zuerst eine Pilzsorte anlegen.',
    'strains.deleteProtected': 'Löschen nicht möglich: noch in Verwendung.',
    'strains.batches': 'Chargen',
    'strains.cultures': 'Kulturen',
    'nav.more': 'Mehr',
    // Scan strip
    'scan.placeholder': 'Barcode hier scannen \u2014 funktioniert auf jedem Tab...',
    'scan.action': 'Aktion',
    'scan.from': 'Von',
    'scan.to': 'Nach',
    'scan.count': 'Anzahl',
    'scan.reset': 'Zur\u00fccksetzen',
    'scan.addBatch': 'Charge hinzufügen',
    'scan.ready': 'Bereit \u2014 scanne ADD, MOVE, REMOVE oder HARVEST',
    'scan.stateReset': 'Zur\u00fcckgesetzt. Scanne ADD, MOVE, REMOVE oder HARVEST.',
    // Harvest panel
    'harvest.logHarvest': 'Ernte erfassen',
    'harvest.grams': 'Gramm',
    'harvest.flush': 'Flush #',
    'harvest.cancel': 'Abbrechen',
    'harvest.enterWeight': 'Bitte ein Gewicht in Gramm eingeben',
    'harvest.cancelled': 'Ernte abgebrochen.',
    // Dashboard
    'dash.totalBatches': 'Chargen gesamt',
    'dash.inIncubation': 'In Inkubation',
    'dash.inTents': 'In Zelten / fruchtend',
    'dash.totalHarvested': 'Gesamt geerntet',
    'dash.alerts': 'Warnungen & Aufgaben',
    'dash.seeAll': 'Alle anzeigen',
    'dash.pipeline': 'Produktions-Pipeline',
    'dash.harvestBySpecies': 'Ernte nach Art (kg)',
    'dash.noHarvestData': 'Noch keine Erntedaten',
    'dash.liveStatus': 'Live Chargen-Status',
    'dash.search': 'Suche...',
    'dash.cards': 'Karten',
    'dash.table': 'Tabelle',
    'dash.rackOccupancy': 'Regal-Belegung',
    'dash.clickRack': 'Klicke auf ein Regal f\u00fcr Details',
    'dash.spawnRacks': 'SPAWN \u2014 2 Regale',
    'dash.incRacks': 'INC \u2014 10 Regale',
    'dash.rack': 'Regal',
    'dash.close': 'Schlie\u00dfen',
    'dash.bagsByLocation': 'Beutel nach Standort',
    'dash.noUrgent': 'Keine dringenden Aufgaben.',
    'dash.view': 'Ansehen',
    'dash.stock': 'Lager',
    'dash.noMatches': 'Keine Chargen gefunden.',
    'dash.noBatches': 'Noch keine Chargen. Erstelle eine unter Chargen \u2192 Neue Charge.',
    'dash.noZones': 'Keine Zonen konfiguriert. Gehe zu Werkzeuge \u2192 Zonen, um Zonen anzulegen.',
    'dash.harvestedAmount': '{g}g geerntet',
    'dash.due': 'F\u00e4llig',
    'dash.bags.one': '{n} Beutel',
    'dash.bags.other': '{n} Beutel',
    'dash.empty': 'Leer',
    'dash.noBagsOnRack': 'Keine Beutel auf diesem Regal.',
    'dash.noBagsIn': 'Keine Beutel in {loc}.',
    'dash.bagsSelected.one': '{n} Beutel ausgew\u00e4hlt',
    'dash.bagsSelected.other': '{n} Beutel ausgew\u00e4hlt',
    'dash.selectAll': 'Alle ausw\u00e4hlen',
    'dash.clear': 'Zur\u00fccksetzen',
    'dash.move': 'Verschieben',
    'dash.remove': 'Entfernen',
    'dash.currentlyIn': 'Aktuell in {loc}',
    'dash.zones': 'Zonen',
    'dash.racks': 'Regale',
    'dash.moveBags': '{n} Beutel verschieben',
    'dash.zoneSpawn': 'Spawn-Phase',
    'dash.zoneInc': 'Inkubation',
    'dash.zoneTent1': 'Zelt 1',
    'dash.zoneTent2': 'Zelt 2',
    'dash.zoneTent3': 'Zelt 3',
    'dash.zoneContam': 'Kontaminiert',
    'dash.fruitingTents': 'Fruchtzelte',
    'dash.overdue': '\u00dcberf\u00e4llig',
    'dash.harvested': 'Geerntet',
    'dash.rackN': 'Regal {n}',
    'dash.legend.title': 'Farb\u00fcbersicht',
    'dash.legend.species': 'Farbiger Balken links an Batch-Karten — jede Art bekommt ihre eigene Farbe, damit man sie auf einen Blick erkennt.',
    'dash.legend.zoneDot': 'Zonen-Punkt in Abschnitts\u00fcberschriften — zeigt die Farbe des jeweiligen Ortes (konfiguriert unter Tools \u2192 Zonen).',
    'dash.legend.orangeDot': 'Oranger Punkt in Batch-Aufgaben — Warnung, Aufgabe wird bald f\u00e4llig oder ben\u00f6tigt Aufmerksamkeit.',
    'dash.legend.redDot': 'Roter Punkt in Batch-Aufgaben — dringend, \u00fcberf\u00e4llig oder kritische Aktion erforderlich.',
    'dash.legend.overdue': 'Rosa hinterlegte Batch-Karte — Batch ist \u00fcberf\u00e4llig (F\u00e4lligkeitsdatum \u00fcberschritten, noch in Inkubation).',
    'dash.legend.capacity': 'Roter Kapazit\u00e4tsbalken — Standort hat seine konfigurierte Maximalkapazit\u00e4t \u00fcberschritten.',
    // Status
    'status.INCUBATING': 'INKUBATION',
    'status.FRUITING': 'FRUCHTEND',
    'status.SPAWN_RUN': 'SPAWN-PHASE',
    'status.CONTAM': 'KONTAM.',
    'status.DONE': 'FERTIG',
    'status.EMPTY': 'LEER',
    'status.action.harvest': 'Ernte / pr\u00fcfen',
    'status.action.moveTent': 'Ins Zelt verschieben',
    'status.action.monitorSpawn': 'Spawn-Phase \u00fcberwachen',
    'status.action.discard': 'Beutel entsorgen',
    // Table headers - dashboard
    'th.batchId': 'Chargen-ID',
    'th.species': 'Art',
    'th.strain': 'Stamm',
    'th.total': 'Gesamt',
    'th.harvested': 'Geerntet',
    'th.due': 'F\u00e4llig',
    'th.status': 'Status',
    'th.action': 'Aktion',
    // Bags
    'bags.one': '{n} Beutel',
    'bags.other': '{n} Beutel',
    'bags.noBags': 'Keine Beutel auf diesem Regal.',
    'bags.noBagsIn': 'Keine Beutel in {zone}.',
    'bags.selected.one': '{n} Beutel ausgew\u00e4hlt',
    'bags.selected.other': '{n} Beutel ausgew\u00e4hlt',
    'bags.selectAll': 'Alle',
    'bags.clear': 'Keine',
    'bags.move': 'Verschieben',
    'bags.remove': 'Entfernen',
    'bags.empty': 'Leer',
    'bags.zones': 'Zonen',
    'bags.racks': 'Regale',
    'bags.currentlyIn': 'Aktuell in {loc}',
    'bags.confirm': 'Best\u00e4tigen',
    'bags.undo': 'R\u00fcckg\u00e4ngig',
    'bags.undoSuccess': 'R\u00fcckg\u00e4ngig gemacht',
    // Batch page
    'batch.allBatches': 'Alle Chargen',
    'batch.newBatch': 'Neue Charge',
    'batch.harvests': 'Ernten',
    'batch.createNew': 'Neue Charge erstellen',
    'batch.batchType': 'Chargentyp',
    'batch.fruitingBlock': 'Fruchtungsblock',
    'batch.grainSpawnBag': 'K\u00f6rnerbrut-Beutel',
    'batch.bagWeight': 'Beutelgewicht',
    'batch.qty': 'Menge (Beutel)',
    'batch.incDays': 'Inkubationstage',
    'batch.substrate': 'Substrat (optional)',
    'batch.hardwood': 'Hartholz %',
    'batch.wheatBran': 'Weizenkleie %',
    'batch.fieldCapacity': 'Feldkapazit\u00e4t %RH',
    'batch.gypsumAdded': 'Gips hinzugef\u00fcgt',
    'batch.sourceCulture': 'Quellkultur (optional)',
    'batch.sourceCultureHint': 'Verkn\u00fcpfung zur PD oder LC f\u00fcr die Beimpfung dieser Charge',
    'batch.none': '\u2014 keine \u2014',
    'batch.notes': 'Notizen (optional)',
    'batch.idPreview': 'Chargen-ID Vorschau',
    'batch.create': 'Charge erstellen',
    'batch.generatedIds': 'Generierte Beutel-IDs',
    'batch.printLabels': 'Etiketten f\u00fcr diese Charge drucken',
    'batch.noBatches': 'Noch keine Chargen.',
    'batch.noMatches': 'Keine Treffer.',
    'batch.addNote': 'Notiz hinzuf\u00fcgen',
    'batch.addBags': '+Beutel',
    'batch.del': 'L\u00f6schen',
    'batch.moveTo': 'Verschieben nach',
    'batch.moveMenuTitle': '{id} verschieben nach\u2026',
    'batch.noLocations': 'Keine Standorte konfiguriert',
    'batch.strainLabel': 'Stamm',
    'batch.strainPlaceholder': 'z.B. BHA-1, Amazing\u2026',
    'batch.whereGo': 'Wohin kommen diese Beutel?',
    'batch.whereGoInfo': '{id} \u2014 {n} Beutel ben\u00f6tigen einen Startstandort.',
    'batch.zones.rename': 'Umbenennen',
    'batch.zones.renamePrompt': 'Neuer Anzeigename f\u00fcr \u201e{old}\u201c:',
    'batch.rename': 'ID umbenennen',
    'batch.renameTitle': 'Charge {id} umbenennen',
    'batch.renameNewId': 'Neue Chargen-ID',
    'batch.renameWarning': 'Alle Beutel, Scan-Log und Ernteeintr\u00e4ge werden aktualisiert. Dies kann nicht r\u00fcckg\u00e4ngig gemacht werden.',
    'batch.renameBtn': 'Umbenennen',
    'batch.renameSuccess': 'Charge umbenannt: {old} \u2192 {new}',
    'batch.deleteBatch': 'Charge {id} l\u00f6schen?',
    'batch.deleteMsg': 'L\u00f6scht den Chargen-Datensatz dauerhaft. Scan-Log und Ernteeintr\u00e4ge bleiben erhalten.',
    'batch.deleteBtn': 'Charge l\u00f6schen',
    'batch.fillFields': 'Bitte Art, Stamm und Menge ausf\u00fcllen',
    'batch.enterWeight': 'Bitte ein Beutelgewicht eingeben',
    'batch.addBagsTo': 'Beutel zur Charge hinzuf\u00fcgen',
    'batch.grainNeeded': 'K\u00f6rner ben\u00f6tigt:',
    'batch.inStock': 'Auf Lager:',
    'batch.sufficient': 'ausreichend',
    'batch.onlyEnoughFor': 'reicht nur f\u00fcr {n} Beutel',
    'batch.bag': 'Beutel:',
    'batch.dryMatterPerBag': 'Trockenmasse pro Beutel:',
    'batch.needed': 'ben\u00f6tigt',
    'batch.shortBy': 'fehlen',
    // Harvest
    'harvest.totalHarvested': 'Gesamt geerntet',
    'harvest.batchesWithYield': 'Chargen mit Ertrag',
    'harvest.topBatch': 'Top-Charge',
    'harvest.totalYieldPerBatch': 'Gesamtertrag pro Charge (g)',
    'harvest.overTime': 'Ernte im Zeitverlauf (w\u00f6chentlich, g)',
    'harvest.perBatchTotals': 'Ertrag pro Charge',
    'harvest.log': 'Ernte-Protokoll',
    'harvest.searchBatch': 'Charge suchen...',
    'harvest.noHarvests': 'Noch keine Ernten. Scanne HARVEST und dann einen Beutel.',
    'harvest.noData': 'Noch keine Erntedaten.',
    'harvest.logged': 'Ernte erfasst: {bag} \u2192 {g}g (Flush {f})',
    'harvest.bagScanned': 'Beutel gescannt: {bag} \u2192 Gramm oben eingeben und Enter dr\u00fccken',
    // Table headers - harvest
    'th.date': 'Datum',
    'th.batch': 'Charge',
    'th.bag': 'Beutel',
    'th.flush': 'Flush',
    'th.grams': 'Gramm',
    // Table headers - batch list
    'th.qty': 'Menge',
    'th.inc': 'Ink.',
    'th.substrate': 'Substrat',
    'th.source': 'Quelle',
    'th.created': 'Erstellt',
    'th.notes': 'Notizen',
    // Lab
    'lab.cultures': 'Kulturen',
    'lab.logWork': 'Arbeit erfassen',
    'lab.lineage': 'Abstammung',
    'lab.cultureLibrary': 'Kulturbibliothek',
    'lab.allTypes': 'Alle Typen',
    'lab.motherCultures': 'Mutterkulturen',
    'lab.petriDishes': 'Petrischalen',
    'lab.liquidCultures': 'Fl\u00fcssigkulturen',
    'lab.allStatuses': 'Alle Status',
    'lab.active': 'Aktiv',
    'lab.stored': 'Gelagert',
    'lab.usedUp': 'Aufgebraucht',
    'lab.contaminated': 'Kontaminiert',
    'lab.deleteCulture': 'Kultur l\u00f6schen',
    'lab.deleteCultureTitle': 'Kultur l\u00f6schen?',
    'lab.deleteCultureMsg': 'Kultur {id} wird unwiderruflich gel\u00f6scht.',
    'lab.deleteChildren': '{n} Nachkommen-Kultur(en) verweisen auf diese Kultur.',
    'lab.deleteBatches': '{n} Charge(n) verweisen auf diese Kultur.',
    'lab.deleteRefWarn': 'Deren Eltern-/Quellen-Verweis wird ung\u00fcltig.',
    'lab.noCultures': 'Noch keine Kulturen. Verwende Labor \u2192 Arbeit erfassen.',
    'lab.logCleanRoom': 'Reinraumarbeit erfassen',
    'lab.workType': 'Arbeitstyp',
    'lab.registerMC': 'Mutterkultur registrieren',
    'lab.pdTransfer': 'Petrischalen-Transfer',
    'lab.lcPrep': 'Fl\u00fcssigkultur ansetzen',
    'lab.g2g': 'Korn-zu-Korn (G2G)',
    'lab.parentCulture': 'Elternkultur',
    'lab.parentMCPDLC': 'Eltern (MC, PD oder LC)',
    'lab.sourcePDMC': 'Quelle (Petrischale oder MC)',
    'lab.noneNewIsolation': '\u2014 keine / neue Isolation \u2014',
    'lab.source': 'Quelle (z.B. Klon, Sporenabdruck, wild)',
    'lab.qtyMade': 'Hergestellte Menge',
    'lab.qtyTubes': 'Menge (R\u00f6hrchen/Schalen)',
    'lab.numDishes': 'Anzahl Schalen',
    'lab.numFlasks': 'Anzahl Kolben',
    'lab.numBags': 'Anzahl Beutel',
    'lab.observations': 'Beobachtungen, Bedingungen...',
    'lab.idsCreated': 'Zu erstellende IDs',
    'lab.logWorkBtn': 'Arbeit erfassen',
    'lab.recentEntries': 'Letzte Labor-Eintr\u00e4ge',
    'lab.noWork': 'Noch keine Laborarbeiten erfasst.',
    'lab.enterSpecies': 'Bitte eine Art eingeben',
    'lab.selectPilzsorte': 'Bitte eine Pilzsorte auswählen',
    'lab.g2gNote': 'G2G wird \u00fcber die Scan-Leiste erfasst \u2014 verwende ADD.',
    'lab.printNow': 'Etiketten jetzt drucken?',
    'lab.qtyDishes': 'Anzahl Schalen',
    'lab.qtyFlasks': 'Anzahl Kolben',
    'lab.qtyBags': 'Anzahl Beutel',
    'lab.parentMcPdLc': 'Eltern (MC, PD oder LC)',
    'lab.sourcePdMc': 'Quelle (Petrischale oder MC)',
    'lab.logged': 'Erfasst: {n} {type} erstellt',
    'lab.noLabWork': 'Noch keine Laborarbeit erfasst.',
    'lab.geneticLineage': 'Genetische Abstammung',
    'lab.selectCultureBatch': '\u2014 Kultur oder Charge w\u00e4hlen \u2014',
    'lab.selectAbove': 'W\u00e4hle oben eine Kultur oder Charge zur Abstammungsverfolgung.',
    'lab.selectAboveShort': 'Kultur oder Charge oben w\u00e4hlen.',
    'lab.noLineageData': 'Keine Abstammungsdaten gefunden.',
    'lab.grainSpawn': 'K\u00f6rnerbrut',
    'lab.createGrainSpawn': 'K\u00f6rnerbrut-Beutel erstellen',
    'lab.grainIdPreview': 'K\u00f6rnerbrut-ID Vorschau',
    'lab.createGrainBtn': 'K\u00f6rnerbrut erstellen',
    'lab.grainCreated': '{n} K\u00f6rnerbrut-Beutel erstellt',
    // Table headers - lab
    'th.id': 'ID',
    'th.type': 'Typ',
    'th.parent': 'Eltern',
    // Print
    'print.printerInfo': 'Druckt direkt auf ZDesigner GK420d',
    'print.printerInfoDetail': '\u00fcber den Server \u2014 kein Dialog n\u00f6tig. Server und Drucker m\u00fcssen eingeschaltet sein.',
    'print.bagLabels': 'Beutel-Etiketten',
    'print.labLabels': 'Labor-Etiketten',
    'print.refBarcodes': 'Referenz-Barcodes',
    'print.selectBatch': 'Charge w\u00e4hlen',
    'print.chooseBatch': '\u2014 Charge w\u00e4hlen \u2014',
    'print.labelContent': 'Etiketteninhalt',
    'print.barcodeIdOnly': 'Barcode + nur ID',
    'print.barcodeIdSpecies': 'Barcode + ID + Stamm/Substrat',
    'print.barcodeIdDate': 'Barcode + ID + Stamm/Substrat + F\u00e4lligkeitsdatum',
    'print.printRange': 'Druckbereich',
    'print.allBags': 'Alle Beutel',
    'print.bagRange': 'Beutelbereich (von\u2013bis)',
    'print.printDirect': 'Etiketten drucken (direkt)',
    'print.preview': 'Vorschau',
    'print.selectBatchAbove': 'W\u00e4hle oben eine Charge.',
    'print.filterCultures': 'Kulturen filtern',
    'print.allActiveCultures': 'Alle aktiven Kulturen',
    'print.createdToday': 'Heute erstellt',
    'print.labelIncludes': 'Etikett enth\u00e4lt',
    'print.code128barcode': 'Code 128 Barcode',
    'print.qrCode': 'QR-Code',
    'print.speciesStrain': 'Art + Stamm',
    'print.parentId': 'Eltern-ID',
    'print.dateCreated': 'Erstellungsdatum',
    'print.printLabDirect': 'Etiketten drucken (direkt)',
    'print.noCultureMatch': 'Keine Kulturen gefunden.',
    'print.tickCultures': 'Kulturen ankreuzen f\u00fcr Etikettenvorschau.',
    'print.refBarcodesTitle': 'Referenz-Barcodes \u2014 drucken & aufh\u00e4ngen',
    'print.qrCodes': 'QR-Codes',
    'print.printSheet': 'Blatt drucken',
    'print.scanInfo': 'Scannen funktioniert auf jedem Tab \u2014 einfach jederzeit von diesem Blatt scannen.',
    'print.selectBatchFirst': 'Bitte zuerst eine Charge w\u00e4hlen.',
    'print.noBagsInRange': 'Keine Beutel in diesem Bereich.',
    'print.selectCulture': 'Bitte mindestens eine Kultur ausw\u00e4hlen.',
    // To-do
    'todo.tasks': 'Aufgaben',
    'todo.team': 'Team',
    'todo.calendar': 'Kalender',
    'todo.batchTasks': 'Chargen-Aufgaben',
    'todo.all': 'Alle',
    'todo.urgentOnly': 'Nur dringende',
    'todo.manualTasks': 'Manuelle Aufgaben',
    'todo.add': '+ Hinzuf\u00fcgen',
    'todo.task': 'Aufgabe',
    'todo.priority': 'Priorit\u00e4t',
    'todo.low': 'Niedrig',
    'todo.medium': 'Mittel',
    'todo.high': 'Hoch',
    'todo.assignTo': 'Zuweisen an',
    'todo.everyone': 'Alle (Firma)',
    'todo.dueDate': 'F\u00e4lligkeitsdatum (optional)',
    'todo.description': 'Beschreibung (optional)',
    'todo.save': 'Speichern',
    'todo.openTasks': 'Offene Aufgaben',
    'todo.urgent': 'Dringend',
    'todo.comingUp': 'Anstehend',
    'todo.noTasks': 'Keine Aufgaben!',
    'todo.noManualTasks': 'Keine manuellen Aufgaben.',
    'todo.dueAgo': 'F\u00e4llig vor {n} Tag(en)',
    'todo.dueIn': 'F\u00e4llig in {n} Tag(en)',
    'todo.fruiting': 'fruchtet',
    'todo.deleteTask': 'Aufgabe l\u00f6schen?',
    'todo.deleteTaskMsg': 'Diese Aufgabe wird dauerhaft gel\u00f6scht.',
    'todo.delete': 'L\u00f6schen',
    'todo.everyone_tag': 'Alle',
    // Days
    'days.ago.one': 'F\u00e4llig vor {n} Tag',
    'days.ago.other': 'F\u00e4llig vor {n} Tagen',
    'days.in.one': 'F\u00e4llig in {n} Tag',
    'days.in.other': 'F\u00e4llig in {n} Tagen',
    'days.inDays': 'F\u00e4llig in {n} Tagen',
    // Team
    'team.members': 'Teammitglieder',
    'team.membersDesc': 'F\u00fcge Teammitglieder hinzu, um Aufgaben individuell zuzuweisen. Jedes Mitglied kann optional einen eigenen CalDAV-Kalender erhalten.',
    'team.noMembers': 'Noch keine Teammitglieder. F\u00fcge unten das erste Mitglied hinzu.',
    'team.name': 'Name',
    'team.role': 'Rolle (optional)',
    'team.addMember': '+ Mitglied hinzuf\u00fcgen',
    'team.removeMember': 'Mitglied entfernen?',
    'team.removeMsg': '{name} wird aus dem Team entfernt. Bestehende Aufgabenzuweisungen bleiben erhalten.',
    'team.removeBtn': 'Entfernen',
    // CalDAV
    'caldav.title': 'CalDAV-Kalenderserver',
    'caldav.desc': 'Dieser Server beinhaltet einen CalDAV-Server. Verbinde eine Kalender-App (Apple Kalender, Thunderbird, DAVx5 auf Android) um deine Aufgaben zu sehen.',
    'caldav.urlTitle': 'CalDAV-URL (in der Kalender-App verwenden)',
    'caldav.password': 'Optional: mit Passwort sch\u00fctzen',
    'caldav.username': 'Benutzername',
    'caldav.userPlaceholder': 'leer lassen f\u00fcr offenen Zugang',
    'caldav.passPlaceholder': 'leer lassen f\u00fcr offenen Zugang',
    'caldav.enableSync': 'Sync aktivieren (Aufgaben in Kalender pushen)',
    'caldav.perPerson': 'Eigener Kalender pro Person',
    'caldav.saveSettings': 'Einstellungen speichern',
    'caldav.syncNow': 'Alle Aufgaben jetzt synchronisieren',
    'caldav.settingsSaved': 'Einstellungen gespeichert.',
    'caldav.enableFirst': 'Zuerst Sync aktivieren und Einstellungen speichern.',
    'caldav.syncing': 'Synchronisiere...',
    'caldav.writingTasks': 'Schreibe Aufgaben in Kalender-Dateien...',
    'caldav.howToConnect': 'So verbinden',
    'caldav.howItWorks': 'So funktioniert es',
    // More / Settings
    'settings.scanLog': 'Scan-Log',
    'settings.user': 'Benutzer',
    'settings.backup': 'Backup',
    'settings.clear': 'L\u00f6schen',
    'settings.noScans': 'Noch keine Scans.',
    'settings.clearLog': 'Gesamtes Scan-Log l\u00f6schen?',
    'settings.clearLogMsg': 'L\u00f6scht dauerhaft alle {n} Scan-Eintr\u00e4ge. Chargen und Ernten werden nicht gel\u00f6scht.',
    'settings.clearLogBtn': 'Ja, alles l\u00f6schen',
    'settings.downloadBackupTitle': 'Backup herunterladen',
    'settings.downloadBackupDesc': 'Ein passwortgeschütztes vollständiges Backup herunterladen. Auf USB, Cloud speichern oder per E-Mail senden.',
    'settings.downloadBackupBtn': 'Backup herunterladen',
    'settings.restoreBackupTitle': 'Backup wiederherstellen',
    'settings.restoreDescHtml': 'Aus einer verschlüsselten Backup-Datei wiederherstellen. <strong style="color:var(--c-red-dark)">Ersetzt alle aktuellen Daten für alle Benutzer.</strong>',
    'settings.restoreBtn': 'Wiederherstellen',
    'settings.syncInfo': 'Sync-Info',
    'settings.syncInfoDesc': 'Alle Daten werden auf dem Server gespeichert \u2014 automatisch für alle Geräte verfügbar. Änderungen werden alle 5 Sekunden synchronisiert. Klicke auf den grünen Punkt für sofortige Synchronisation.',
    'settings.restoreBackup': 'Dieses Backup wiederherstellen?',
    'settings.restoreMsg': 'Ersetzt ALLE Daten auf dem Server für alle Benutzer. Kann nicht rückgängig gemacht werden.',
    'settings.restoreConfirm': 'Ja, wiederherstellen',
    'settings.invalidFile': 'Ung\u00fcltige Datei.',
    'settings.cannotRead': 'Datei kann nicht gelesen werden.',
    // Table headers - scan log
    'th.time': 'Zeit',
    // Sync
    'sync.syncing': 'Synchronisiere...',
    'sync.synced': 'Synchronisiert {time}',
    'sync.saving': 'Speichere...',
    'sync.saved': 'Gespeichert {time}',
    'sync.error': 'Sync-Fehler',
    'sync.saveError': 'Speicherfehler \u2014 Server erreichbar?',
    'sync.clickToSync': 'Klicken zum Synchronisieren',
    // Inventory
    'inv.stock': 'Bestand',
    'inv.logDelivery': 'Lieferung erfassen',
    'inv.usageLog': 'Verbrauchsprotokoll',
    'inv.alertThresholds': 'Warnschwellen',
    'inv.alertThresholdsDesc': 'Mindestbestand f\u00fcr Warnung festlegen. Auch die Standard-Beutelgr\u00f6\u00dfe f\u00fcr die Sch\u00e4tzung "reicht f\u00fcr X Beutel" einstellen.',
    'inv.lowStock': 'NIEDRIGER BESTAND',
    'inv.alertBelow': 'Warnung unter {n}kg',
    'inv.logDeliveryBtn': '+ Lieferung erfassen',
    'inv.logIncoming': 'Eingehende Lieferung erfassen',
    'inv.material': 'Material',
    'inv.currentStock': 'Aktueller Bestand: {n} kg',
    'inv.amountReceived': 'Erhaltene Menge (kg)',
    'inv.supplierNote': 'Lieferant / Notiz (optional)',
    'inv.addToStock': 'Zum Bestand hinzuf\u00fcgen',
    'inv.afterDelivery': 'Nach Lieferung:',
    'inv.manualAdj': 'Manuelle Anpassung',
    'inv.manualAdjDesc': 'Zum Korrigieren des Bestands nach Z\u00e4hlung, Verderb oder Abweichung.',
    'inv.setStockTo': 'Bestand setzen auf (kg)',
    'inv.orAddSubtract': 'oder addieren / abziehen',
    'inv.adjustBy': 'Anpassen um (kg) \u2014 negativ zum Abziehen',
    'inv.reason': 'Grund',
    'inv.apply': 'Anwenden',
    'inv.usageHistory': 'Materialverbrauch-Verlauf',
    'inv.allMaterials': 'Alle Materialien',
    'inv.noUsageHistory': 'Noch kein Verbrauchsverlauf.',
    'inv.enterQty': 'Bitte eine Menge gr\u00f6\u00dfer als 0 eingeben',
    'inv.enterAmount': 'Bitte einen neuen Gesamtwert oder Anpassungsbetrag eingeben',
    'inv.grainBags': '\u2248 {n} K\u00f6rnerbeutel \u00e0 {kg}kg',
    'inv.blocks': '\u2248 <strong>{n}</strong> \u00d7 {kg}kg Bl\u00f6cke <span style="font-size:10px;color:var(--c-text-muted)">(Sch\u00e4tzung)</span>',
    'inv.avgComposition': 'Durchschnittszusammensetzung f\u00fcr Sch\u00e4tzungen',
    'inv.avgCompDesc': 'Diese Durchschnittswerte berechnen "\u007eX Beutel" auf den Bestandskarten. Nur <strong>Sch\u00e4tzwerte</strong> \u2014 exakter Verbrauch wird bei Chargenerstellung mit Substratrezept erfasst.',
    'inv.hardwoodPct': 'Hartholz %',
    'inv.wheatBranPct': 'Weizenkleie %',
    'inv.waterPct': 'Wasser % (RH)',
    'inv.blockWeight': 'Blockgewicht (kg)',
    'inv.grainBagKg': 'K\u00f6rnerbeutel (kg)',
    'inv.lowStockAlert': 'Niedriger Bestand: {mat}',
    // Material labels
    'mat.hardwood': 'Hartholzpellets',
    'mat.wheatbran': 'Weizenkleie',
    'mat.gypsum': 'Gips',
    'mat.grain': 'K\u00f6rner',
    // Table headers - inventory
    'th.material': 'Material',
    'th.inStock': 'Auf Lager',
    'th.alertBelow': 'Warnung unter (kg)',
    'th.estBags': 'Gesch. Beutel (Ø)',
    // Assets
    'assets.overview': '\u00dcbersicht',
    'assets.add': 'Hinzuf\u00fcgen',
    'assets.labels': 'Etiketten',
    'assets.export': 'Export',
    'assets.title': 'Anlageinventar',
    'assets.name': 'Bezeichnung',
    'assets.category': 'Kategorie',
    'assets.purchasePrice': 'Kaufpreis',
    'assets.bookValue': 'Buchwert',
    'assets.location': 'Standort',
    'assets.actions': 'Aktionen',
    'assets.total': 'Gesamt',
    'assets.purchaseValueActive': 'Anschaffungswert (aktiv)',
    'assets.bookValueToday': 'Buchwert heute (aktiv)',
    'assets.noAssets': 'Keine Anlagen erfasst. Klicke auf "Hinzuf\u00fcgen" um loszulegen.',
    'assets.edit': 'Bearb.',
    'assets.print': 'Druck',
    'assets.addAsset': 'Anlage erfassen',
    'assets.entryDate': 'Anschaffungsdatum',
    'assets.usefulLife': 'Nutzungsdauer (Jahre)',
    'assets.depMethod': 'Abschreibungsmethode',
    'assets.linear': 'Linear',
    'assets.supplier': 'Lieferant',
    'assets.invoiceNr': 'Rechnungsnummer',
    'assets.serialNr': 'Seriennummer',
    'assets.exitDate': 'Abgangsdatum',
    'assets.saveBtn': 'Speichern',
    'assets.resetBtn': 'Zur\u00fccksetzen',
    'assets.newId': 'Neue ID: {id}',
    'assets.editing': 'Bearbeiten: {id}',
    'assets.fillRequired': 'Bitte alle Pflichtfelder ausf\u00fcllen.',
    'assets.deleteAsset': 'Anlage l\u00f6schen?',
    'assets.deleteMsg': 'Die Anlage {id} wird unwiderruflich gel\u00f6scht.',
    'assets.deleteBtn': 'Ja, l\u00f6schen',
    'assets.csvExport': 'CSV-Export',
    'assets.csvDesc': 'Komplette Inventarliste mit allen Feldern und berechneten Abschreibungswerten als CSV f\u00fcr den Steuerberater.',
    'assets.exportCsv': 'CSV exportieren',
    'assets.cutoffInv': 'Stichtags-Inventur',
    'assets.cutoffDate': 'Stichtag',
    'assets.calculate': 'Berechnen',
    'assets.chooseCutoff': 'Bitte Stichtag w\u00e4hlen.',
    'assets.printLabels': 'Inventar-Etiketten drucken',
    'assets.all': 'Alle',
    'assets.none': 'Keine',
    'assets.printBtn': 'Drucken',
    'assets.downloadZPL': 'ZPL herunterladen',
    'assets.noAssetsAvail': 'Keine Anlagen vorhanden.',
    'assets.selectAsset': 'Bitte mindestens eine Anlage ausw\u00e4hlen.',
    'assets.printError': 'Druckfehler: ',
    // Asset categories
    'assets.cat.Maschinen': 'Maschinen',
    'assets.cat.B\u00fcroausstattung': 'B\u00fcroausstattung',
    'assets.cat.EDV': 'EDV',
    'assets.cat.Labor': 'Labor',
    'assets.cat.Fahrzeuge': 'Fahrzeuge',
    'assets.cat.Sonstiges': 'Sonstiges',
    // Asset statuses
    'assets.status.aktiv': 'Aktiv',
    'assets.status.ausgeschieden': 'Ausgeschieden',
    'assets.status.verkauft': 'Verkauft',
    'assets.status.verschrottet': 'Verschrottet',
    // CSV headers
    'csv.invNr': 'Inventar-Nr',
    'csv.name': 'Bezeichnung',
    'csv.category': 'Kategorie',
    'csv.entryDate': 'Anschaffungsdatum',
    'csv.purchaseCost': 'Anschaffungskosten',
    'csv.usefulLife': 'Nutzungsdauer (J.)',
    'csv.annualDepr': 'Jahres-AfA',
    'csv.accumDepr': 'Kumulierte AfA',
    'csv.bookValue': 'Buchwert',
    'csv.gwg': 'GWG',
    'csv.status': 'Status',
    'csv.supplier': 'Lieferant',
    'csv.invoiceNr': 'Rechnungsnr',
    'csv.serialNr': 'Seriennr',
    'csv.location': 'Standort',
    'csv.exitDate': 'Abgangsdatum',
    'csv.remarks': 'Bemerkungen',
    'csv.yes': 'Ja',
    'csv.no': 'Nein',
    // Cutoff report
    'cutoff.date': 'Stichtag: {date} \u2014 {n} aktive Anlagen',
    'cutoff.nr': 'Nr',
    'cutoff.purchaseCost': 'Anschaffungskosten',
    'cutoff.accumDepr': 'Kum. AfA',
    'cutoff.sum': 'Summe',
    // Bag info modal
    'bagInfo.currentLocation': 'Aktueller Standort',
    'bagInfo.notPlaced': 'Noch nicht platziert',
    'bagInfo.removed': 'Entfernt',
    'bagInfo.noneYet': 'Noch keine',
    'bagInfo.allBags': 'Alle Beutel',
    'bagInfo.addThisBag': '+ HINZUF\u00dcGEN',
    'bagInfo.moveThisBag': 'VERSCHIEBEN',
    'bagInfo.harvestThisBag': 'ERNTE erfassen',
    'bagInfo.removeThisBag': 'X ENTFERNEN',
    // Confirm modal
    'confirm.confirm': 'Best\u00e4tigen',
    'confirm.cancel': 'Abbrechen',
    // Note modal
    'note.title': 'Notiz \u2014 {id}',
    'note.save': 'Speichern',
    'note.cancel': 'Abbrechen',
    // Scan feedback
    'scanFb.actionAdd': 'Aktion: ADD \u2192 Standort/Regal scannen, dann Beutel',
    'scanFb.actionMove': 'Aktion: MOVE \u2192 Ziel-Standort scannen, dann Beutel',
    'scanFb.actionRemove': 'Aktion: REMOVE \u2192 Beutel scannen',
    'scanFb.actionHarvest': 'Aktion: HARVEST \u2192 Beutel f\u00fcr Gewichtserfassung scannen',
    'scanFb.location': 'Standort: {loc} \u2192 jetzt Beutel scannen',
    'scanFb.from': 'Von: {loc} \u2192 NACH-Standort scannen',
    'scanFb.to': 'Nach: {loc} \u2192 jetzt Beutel scannen',
    'scanFb.setAction': 'Zuerst Aktion setzen \u2014 scanne ADD, MOVE, REMOVE oder HARVEST.',
    'scanFb.scanLocFirst': 'Zuerst Standort oder Regal scannen.',
    'scanFb.scanFromTo': 'Erst VON- und NACH-Standort scannen.',
    'scanFb.scanToFirst': 'Erst Ziel-Standort scannen.',
    'scanFb.logged': 'Erfasst: {action} {val}{to} [{n} diese Sitzung]',
    'scanFb.bagNotPlaced': '{bag} hat keinen bekannten Standort \u2014 erst mit ADD platzieren',
    'scanFb.bagRemoved': '{bag} wurde entfernt \u2014 erst mit ADD neu platzieren',
    'scanFb.bagAlreadyAt': '{bag} ist bereits an {loc}',
    'scanFb.unknown': 'Unbekannter Barcode: {val}. Pr\u00fcfe ob die Charge existiert.',
    'scanFb.unknownFormat': 'Unbekanntes Format: {val} — Barcode pr\u00fcfen.',
    'scanFb.matched': 'Zugeordnet: {val} aus {batch}',
    'scanFb.noBatchFound': 'Keine Charge f\u00fcr {val} gefunden \u2014 Art/Stamm/Datum pr\u00fcfen',
    'scanFb.removeLogged': 'REMOVE erfasst: {bag}',
    'scanFb.actionReady': '{action} bereit \u2014 Standort scannen, dann weitere Beutel',
    'scanFb.bagInfo': 'Beutel-Info: {bag} \u2014 Aktion unten w\u00e4hlen oder schlie\u00dfen',
    'scanFb.cultureScanned': 'Kultur gescannt: {val} \u2192 Abstammungsansicht',
    'scanFb.moved': '{n} verschoben \u2192 {loc}',
    'scanFb.removed': '{n} entfernt',
    'scanFb.confirmRemove': '{n} entfernen?',
    // Batch add modal
    'batchAdd.title': 'Beutel zur Charge hinzuf\u00fcgen',
    'batchAdd.willLog': 'Erfasst {n} Beutel \u2192 {loc}',
    'batchAdd.selectFirst': 'Zuerst eine Charge w\u00e4hlen',
    'batchAdd.batchAdd': 'Chargen-ADD: {n} Beutel \u2192 {loc}',
    // Add bags modal
    'addBags.title': 'Beutel hinzuf\u00fcgen',
    'addBags.info': '{id} hat aktuell {n} Beutel ({last} ist letzter)',
    'addBags.enterQty': 'Mindestens 1 eingeben',
    'addBags.added': '{qty} zu {id} hinzugef\u00fcgt (jetzt {total} gesamt)',
    'addBags.addedTitle': 'Beutel hinzugef\u00fcgt',
    'addBags.howMany': 'Wie viele Beutel hinzuf\u00fcgen',
    'addBags.printLabels': 'Etiketten drucken',
    'addBags.printed': '{n} Etiketten f\u00fcr {id} gedruckt',
    'addBags.close': 'Schlie\u00dfen',
    // Delivery/adjustment feedback
    'inv.deliveryLogged': 'Lieferung erfasst: +{kg}kg {mat} jetzt {total}kg gesamt',
    'inv.adjusted': '{mat} angepasst: {delta}kg jetzt {total}kg gesamt',
    'inv.suppliers': 'Lieferanten',
    'inv.suppliersDesc': 'Lieferanten pro Material verwalten, damit Sie wissen, wo nachbestellt werden kann.',
    'inv.addSupplier': 'Lieferant hinzuf\u00fcgen',
    'inv.supplierName': 'Name',
    'inv.supplierUrl': 'Website',
    'inv.supplierPhone': 'Telefon',
    'inv.supplierNotes': 'Notizen',
    'inv.noSuppliers': 'Noch keine Lieferanten hinzugef\u00fcgt.',
    'inv.reorderFrom': 'Nachbestellen bei',
    'inv.editSupplier': 'Bearbeiten',
    'inv.deleteSupplier': 'L\u00f6schen',
    'inv.supplierSaved': 'Lieferant gespeichert',
    'inv.supplierDeleted': 'Lieferant gel\u00f6scht',
    // Print feedback
    'print.printed': '{n} Etiketten f\u00fcr {id} gedruckt',
    'print.printedLabels': '{n} Labor-Etikett(en) gedruckt',
    'print.assetLabelsPrinted.one': '{n} Inventar-Etikett gedruckt',
    'print.assetLabelsPrinted.other': '{n} Inventar-Etiketten gedruckt',
    // CalDAV feedback
    'caldav.done': 'Fertig! {n} Aufgaben in Kalender geschrieben.{errors} Kalender-Apps k\u00f6nnen sie jetzt via CalDAV sehen.',
    'caldav.syncFail': 'Sync fehlgeschlagen: {err}',
    'caldav.syncError': 'Sync-Fehler: {err}',
    // Backup validation
    'settings.valid': 'G\u00fcltig: {date} \u2014 {batches} Chargen, {scans} Scans, {cultures} Kulturen, Inventar: {inv}.',
    // Static HTML keys
    'batch.batchId': 'Chargen-ID',
    'batch.species': 'Art',
    'batch.strain': 'Stamm',
    'batch.notFound': 'Charge nicht gefunden',
    'nav.cancel': 'Abbrechen',
    'settings.time': 'Zeit',
    'settings.action': 'Aktion',
    'settings.bag': 'Beutel',
    'settings.from': 'Von',
    'settings.to': 'Nach',
    'settings.restoreDescHtml': 'Aus einer verschlüsselten Backup-Datei wiederherstellen. <strong style="color:var(--c-red-dark)">Ersetzt alle aktuellen Daten für alle Nutzer.</strong>',
    'mcp.title': 'MCP Server',
    'mcp.desc': 'Ermöglicht Claude und anderen KI-Assistenten Zugriff auf die MeisterTracker-Datenbank über das Model Context Protocol. Claude verbindet sich automatisch per OAuth \u2014 einfach die URL einfügen.',
    'mcp.enable': 'MCP Server aktivieren',
    'mcp.connectorUrl': 'Connector URL',
    'mcp.copy': 'Kopieren',
    'mcp.apiKey': 'API-Schlüssel (Skripte / Automatisierung)',
    'mcp.generateKey': 'API-Schlüssel generieren',
    'mcp.keyHint': 'Für Skripte oder Tools, die kein OAuth unterstützen. Als Bearer-Token im Authorization-Header verwenden. Wird nur einmal angezeigt.',
    'mcp.save': 'Speichern',
    'mcp.active': 'MCP Server aktiv',
    'mcp.noKey': 'MCP aktiviert \u2014 bereit zur Verbindung über OAuth.',
    'mcp.sessions': 'MCP Server aktiv \u2014 {n} Sitzung(en)',
    'mcp.urlCopied': 'URL kopiert!',
    'mcp.keyCopied': 'Schlüssel kopiert!',
    'mcp.keyGenerated': 'API-Schlüssel generiert. Jetzt kopieren!',
    'mcp.saved': 'Einstellungen gespeichert.',
    'mcp.error': 'Fehler: {msg}',
    'mcp.guideTitle': 'Anleitung',
    'mcp.diagTitle': 'Diagnose',
    'mcp.runDiag': 'Diagnose starten',
    'mcp.diagRunning': 'Diagnose läuft...',
    'mcp.diagFailed': 'Diagnose fehlgeschlagen',
    'mcp.diagAutoClients': 'Auto-registrierte Clients',
    'mcp.diagManualClients': 'Manuelle Clients',
    'mcp.diagSessions': 'Aktive MCP-Sitzungen',
    'mcp.oauthTitle': 'Verbundene Clients',
    'mcp.oauthDesc': 'Clients, die sich per OAuth verbunden haben. Claude registriert sich automatisch, wenn du die Connector-URL hinzufügst.',
    'mcp.noClients': 'Noch keine verbundenen Clients. Verbinde Claude, indem du die URL oben einfügst.',
    'mcp.clientName': 'Name',
    'mcp.unnamed': '(unbenannt)',
    'mcp.created': 'Erstellt',
    'mcp.activeSessions': 'Sitzungen',
    'mcp.deleteClient': 'Löschen',
    'mcp.confirmDelete': 'Diesen Client löschen? Alle aktiven Sitzungen werden widerrufen.',
    'mcp.confirmDeleteAuto': 'Diesen auto-registrierten Client widerrufen? Claude registriert sich bei der nächsten Verbindung erneut.',
    'mcp.clientDeleted': 'Client gelöscht.',
    'mcp.step1': '1. MCP Server aktivieren und speichern',
    'mcp.step2': '2. Connector URL oben kopieren',
    'mcp.step3': '3. In Claude: Einstellungen \u2192 Connectors \u2192 Hinzufügen \u2192 URL einfügen',
    'mcp.step4': '4. Bei Aufforderung einloggen \u2014 fertig! Claude verbindet sich automatisch per OAuth.',
    'mcp.features': 'Verfügbare Funktionen: Tagesbriefing, Batches verwalten, Aufgaben, Kalender, Inventar, Ernten, Kulturen, Zonen-Übersicht',
    'todo.taskPlaceholder': 'z.B. Feuchtigkeitszelt reinigen',
    'todo.descPlaceholder': 'Weitere Details...',
    'inv.hardwood': 'Hartholzpellets',
    'inv.wheatBran': 'Weizenkleie',
    'inv.gypsum': 'Gips',
    'inv.grain': 'Getreide',
    'inv.date': 'Datum',
    'inv.changeKg': '\u00c4nderung (kg)',
    'inv.runningTotal': 'Laufende Summe',
    'inv.type': 'Typ',
    'inv.reference': 'Referenz',
    'asset.overview': '\u00dcbersicht',
    'asset.addNew': 'Hinzuf\u00fcgen',
    'asset.export': 'Export',
    'asset.labels': 'Etiketten',
    'asset.inventory': 'Anlageinventar',
    'asset.allCategories': 'Alle Kategorien',
    'asset.allStatus': 'Alle Status',
    'asset.cat.machinery': 'Maschinen',
    'asset.cat.office': 'B\u00fcroausstattung',
    'asset.cat.it': 'EDV',
    'asset.cat.lab': 'Labor',
    'asset.cat.vehicles': 'Fahrzeuge',
    'asset.cat.other': 'Sonstiges',
    'asset.status.aktiv': 'Aktiv',
    'asset.status.ausgeschieden': 'Ausgeschieden',
    'asset.status.verkauft': 'Verkauft',
    'asset.status.verschrottet': 'Verschrottet',
    'asset.nr': 'Nr',
    'asset.name': 'Name',
    'asset.category': 'Kategorie',
    'asset.purchasePrice': 'Kaufpreis',
    'asset.bookValue': 'Buchwert',
    'asset.status': 'Status',
    'asset.location': 'Standort',
    'asset.actions': 'Aktionen',
    'asset.recordAsset': 'Anlage erfassen',
    'asset.designation': 'Bezeichnung *',
    'asset.designationPh': 'z.B. Autoklav 50L',
    'asset.acquisitionDate': 'Anschaffungsdatum *',
    'asset.netPrice': 'Einkaufspreis (\u20ac netto) *',
    'asset.usefulLife': 'Nutzungsdauer (Jahre) *',
    'asset.deprMethod': 'AfA-Methode',
    'asset.linear': 'Linear',
    'asset.supplier': 'Lieferant',
    'asset.supplierPh': 'Firmenname',
    'asset.invoiceNr': 'Rechnungsnummer',
    'asset.serialNr': 'Seriennummer',
    'asset.locationPh': 'z.B. Labor, B\u00fcro',
    'asset.exitDate': 'Abgangsdatum',
    'asset.notes': 'Notizen',
    'asset.save': 'Speichern',
    'asset.reset': 'Zur\u00fccksetzen',
    'asset.csvExport': 'CSV-Export',
    'asset.csvExportDesc': 'Komplette Inventarliste mit allen Feldern und berechneten Abschreibungswerten als CSV f\u00fcr den Steuerberater.',
    'asset.exportCsv': 'CSV exportieren',
    'asset.cutoffInventory': 'Stichtags-Inventur',
    'asset.cutoffDate': 'Stichtag',
    'asset.calculate': 'Berechnen',
    'asset.printLabels': 'Inventar-Etiketten drucken',
    'asset.selectAll': 'Alle',
    'asset.selectNone': 'Keine',
    'asset.print': 'Drucken',
    'asset.downloadZpl': 'ZPL herunterladen',
    // Zones
    'zones.title': 'Zonen & Racks',
    'zones.desc': 'Verwalte die Standorte deiner Farm. Zonen lassen sich nur löschen, wenn keine Bags darin sind.',
    'zones.addTitle': 'Zone hinzufügen',
    'zones.zoneName': 'Name',
    'zones.zoneRole': 'Rolle',
    'zones.zoneColor': 'Farbe',
    'zones.zoneRacks': 'Racks (optional, kommagetrennt)',
    'zones.add': 'Zone hinzufügen',
    'zones.delete': 'Löschen',
    'zones.deleteTitle': 'Zone löschen?',
    'zones.deleteMsg': 'Zone „{name}" und alle zugehörigen Racks werden entfernt.',
    'zones.noRacks': 'Keine Racks',
    'zones.rackPrompt': 'Rack-Name (z.B. R3):',
    'zones.errShort': 'Zonenname zu kurz (mind. 2 Zeichen)',
    'zones.errExists': 'Zone existiert bereits',
    'zones.errRackExists': 'Rack existiert bereits',
    'zones.empty': 'Keine Zonen konfiguriert.',
    'zones.roleSpawn': 'Spawn',
    'zones.roleIncubation': 'Inkubation',
    'zones.roleFruiting': 'Fruchtung',
    'zones.roleContaminated': 'Kontamination',
    'zones.errIdStart': 'Zonenname muss mit einem Buchstaben (A-Z) beginnen',
    'zones.errLong': 'Zonenname zu lang (max. 50 Zeichen)',
    'zones.errRackEmpty': 'Rack-Name darf nicht leer sein',
    'zones.errTooManyRacks': 'Zu viele Racks (max. 50)',
    'zones.hasBags': '{count} Bags — erst entfernen',
    'zones.directBags': '{count} ohne Rack',
    'zones.directBagsHint': 'Diese Bags wurden zur Zone gescannt, nicht zu einem Rack. Verschiebe sie in ein Rack für genaues Tracking.',
    'zones.dragToReorder': 'Zum Neuordnen ziehen',
    'zones.edit': 'Bearbeiten',
    'zones.editTitle': 'Zone bearbeiten',
    'zones.moveToRack': 'In Rack verschieben',
    'zones.moveToRackTitle': '{count} Bags in ein Rack verschieben',
    'zones.movedToRack': '{count} Bags nach {rack} verschoben',
    'zones.addRack': '+ Rack',
    'zones.rackDeleteTitle': 'Rack löschen?',
    'zones.rackDeleteMsg': 'Rack „{name}" wird entfernt.',
    'zones.showQr': 'QR anzeigen',
    'zones.hideQr': 'QR ausblenden',
    'zones.printQr': 'QR drucken',
    'zones.printAllQr': 'Alle QR-Codes drucken',
    'zones.capacity': 'Max. Kapazität (Bags)',
    'zones.errCapacity': 'Kapazität muss eine positive Zahl sein',
    'scanFb.preferRack': '⚠ „{loc}" ist eine Zone — scanne ein Rack für genaues Tracking (z.B. {example})',
    // Calendar entry modal
    'calEntry.titleNew': 'Neuer Eintrag',
    'calEntry.titleEdit': 'Eintrag bearbeiten',
    'calEntry.name': 'Titel',
    'calEntry.namePhTask': 'z.B. Luftfeuchtezelt reinigen',
    'calEntry.namePhEvent': 'z.B. Team-Meeting',
    'calEntry.category': 'Kategorie',
    'calEntry.cat.task': 'Aufgabe',
    'calEntry.cat.custom': 'Eigener Termin',
    'calEntry.cat.meeting': 'Meeting',
    'calEntry.cat.delivery': 'Lieferung',
    'calEntry.cat.maintenance': 'Wartung',
    'calEntry.prio': 'Priorität',
    'calEntry.prio.low': 'Niedrig',
    'calEntry.prio.med': 'Mittel',
    'calEntry.prio.high': 'Hoch',
    'calEntry.date': 'Datum',
    'calEntry.endDate': 'Bis (optional)',
    'calEntry.allDay': 'Ganztägig',
    'calEntry.from': 'Von',
    'calEntry.to': 'Bis',
    'calEntry.recurrence': 'Wiederholung',
    'calEntry.rec.none': 'Keine',
    'calEntry.rec.daily': 'Täglich',
    'calEntry.rec.weekly': 'Wöchentlich',
    'calEntry.rec.monthly': 'Monatlich',
    'calEntry.recurrenceUntil': 'Wiederholen bis (optional)',
    'calEntry.desc': 'Beschreibung (optional)',
    'calEntry.descPh': 'Details...',
    'calEntry.assignTo': 'Zuweisen an',
    'calEntry.assignTo.all': 'Alle (Betrieb)',
    'calEntry.assignedTo': 'Zugewiesen an',
    'calEntry.allClickToSelect': 'Alle (klicken um auszuwählen)',
    'calEntry.noMembers': 'Noch keine Teammitglieder. Zuerst im Team-Tab hinzufügen.',
    'calEntry.private': 'Nur für zugewiesene Person sichtbar',
    'calEntry.cancel': 'Abbrechen',
    'calEntry.save': 'Speichern',
    'calEntry.delete': 'Löschen',
    'calEntry.deleteTask': 'Aufgabe löschen?',
    'calEntry.deleteEvent': 'Event löschen?',
    'calEntry.deleteTaskMsg': 'Diese Aufgabe wird unwiderruflich gelöscht.',
    'calEntry.deleteEventMsg': 'Dieses Event wird unwiderruflich gelöscht.',
    // Calendar views
    'cal.allDay': 'Ganztägig',
    'cal.allDayShort': 'Ganzt.',
    'cal.noAllDay': 'Keine ganztägigen Events',
    'cal.more': 'mehr',
    'cal.title': 'Kalender',
    'cal.monthView': 'Monatsansicht',
    'cal.weekView': 'Wochenansicht',
    'cal.dayView': 'Tagesansicht',
    'cal.printed': 'gedruckt am',
    'cal.legend.batches': 'Fälligkeiten',
    'cal.legend.tasks': 'Aufgaben',
    'cal.legend.harvests': 'Ernten',
    'cal.legend.custom': 'Eigene Termine',
    'cal.legend.meetings': 'Meetings',
    'cal.legend.deliveries': 'Lieferungen',
    'cal.legend.maintenance': 'Wartung',
    'cal.legend.external': 'Externe Termine',
    'cal.days': 'Mo,Di,Mi,Do,Fr,Sa,So',
    'cal.months': 'Januar,Februar,März,April,Mai,Juni,Juli,August,September,Oktober,November,Dezember',
    'calEntry.moveTitle': 'Eintrag verschieben',
    'calDetail.close': 'Schließen',
    'calDetail.edit': 'Bearbeiten',
    'calDetail.assignedTo': 'Zugewiesen',
    'calDetail.everyone': 'Alle',
    'calDetail.taskDue': 'Aufgabe',
    'calDetail.dueLabel': 'Fällig',
    'calDetail.markDone': 'Als erledigt markieren',
    'calDetail.markUndone': 'Als unerledigt markieren',
    'calDetail.batchDue': 'Charge fällig',
    'calDetail.harvest': 'Ernte',
    'calDetail.external': 'Externer Termin',
    'calEntry.until': 'bis',
    'cal.monthShort': 'Monat',
    'cal.weekShort': 'Woche',
    'cal.dayShort': 'Tag',
    'cal.printTitle': 'Kalender drucken',
    'cal.newEntry': '+ Neu',
    'cal.taskListTitle': 'Aufgabenliste',
    'cal.entries': 'Einträge',
    'cal.noTasks': 'keine Aufgaben',
    'cal.printChooseRange': 'Wähle den Zeitraum für die Aufgabenliste:',
    'cal.printWeek': 'Woche — Aufgabenliste der aktuellen Woche',
    'cal.printMonth': 'Monat — Aufgabenliste des aktuellen Monats',
  },
  pt: {
    // Nav
    'nav.main': 'Principal',
    'nav.tools': 'Ferramentas',
    'nav.dashboard': 'Painel',
    'nav.batches': 'Lotes',
    'nav.lab': 'Laborat\u00f3rio',
    'nav.inventory': 'Invent\u00e1rio',
    'nav.zones': 'Zonas',
    'nav.assets': 'Ativos',
    'nav.print': 'Imprimir',
    'nav.strains': 'Pilzsorten',
    'nav.todo': 'Tarefas',
    'nav.calendar': 'Calendário',
    'strains.manage': 'Gerir Pilzsorten',
    'strains.list': 'Pilzsorten existentes',
    'strains.name': 'Nome',
    'strains.namePlaceholder': 'ex. Shiitake',
    'strains.kuerzel': 'Abrev.',
    'strains.kuerzelPlaceholder': 'ex. SHI',
    'strains.description': 'Descrição (opcional)',
    'strains.save': 'Guardar Pilzsorte',
    'strains.cancel': 'Cancelar',
    'strains.inUse': 'Em uso',
    'strains.hint': 'Sem Pilzsorte, não é possível criar lotes.',
    'strains.pilzsorte': 'Pilzsorte',
    'strains.selectPlaceholder': '— seleccionar Pilzsorte —',
    'strains.noStrainsHint': 'Nenhuma Pilzsorte definida. Crie uma primeiro.',
    'strains.deleteProtected': 'Não é possível apagar: ainda em uso.',
    'strains.batches': 'lotes',
    'strains.cultures': 'culturas',
    'nav.more': 'Mais',
    // Scan strip
    'scan.placeholder': 'Escaneie c\u00f3digo de barras aqui \u2014 funciona em todas as abas...',
    'scan.action': 'A\u00e7\u00e3o',
    'scan.from': 'De',
    'scan.to': 'Para',
    'scan.count': 'Cont.',
    'scan.reset': 'Resetar',
    'scan.addBatch': 'Adicionar lote',
    'scan.ready': 'Pronto \u2014 escaneie ADD, MOVE, REMOVE ou HARVEST para come\u00e7ar',
    'scan.stateReset': 'Resetado. Escaneie ADD, MOVE, REMOVE ou HARVEST para come\u00e7ar.',
    // Harvest panel
    'harvest.logHarvest': 'Registrar colheita',
    'harvest.grams': 'Gramas',
    'harvest.flush': 'Flush #',
    'harvest.cancel': 'Cancelar',
    'harvest.enterWeight': 'Insira o peso em gramas',
    'harvest.cancelled': 'Colheita cancelada.',
    // Dashboard
    'dash.totalBatches': 'Total de lotes',
    'dash.inIncubation': 'Em incuba\u00e7\u00e3o',
    'dash.inTents': 'Em tendas / frutificando',
    'dash.totalHarvested': 'Total colhido',
    'dash.alerts': 'Alertas e tarefas',
    'dash.seeAll': 'Ver tudo',
    'dash.pipeline': 'Pipeline de produ\u00e7\u00e3o',
    'dash.harvestBySpecies': 'Colheita por esp\u00e9cie (kg)',
    'dash.noHarvestData': 'Sem dados de colheita ainda',
    'dash.liveStatus': 'Status dos lotes ao vivo',
    'dash.search': 'Buscar...',
    'dash.cards': 'Cart\u00f5es',
    'dash.table': 'Tabela',
    'dash.rackOccupancy': 'Ocupa\u00e7\u00e3o das estantes',
    'dash.clickRack': 'Clique numa estante para ver conte\u00fado',
    'dash.spawnRacks': 'SPAWN \u2014 2 estantes',
    'dash.incRacks': 'INC \u2014 10 estantes',
    'dash.rack': 'Estante',
    'dash.close': 'Fechar',
    'dash.bagsByLocation': 'Sacos por localiza\u00e7\u00e3o',
    'dash.noUrgent': 'Nenhuma tarefa urgente no momento.',
    'dash.view': 'Ver',
    'dash.stock': 'Estoque',
    'dash.noMatches': 'Nenhum lote encontrado.',
    'dash.noBatches': 'Nenhum lote ainda. Crie um em Lotes \u2192 Novo lote.',
    'dash.noZones': 'Nenhuma zona configurada. V\u00e1 para Ferramentas \u2192 Zonas para adicionar zonas.',
    'dash.harvestedAmount': '{g}g colhido',
    'dash.due': 'Vencimento',
    'dash.bags.one': '{n} saco',
    'dash.bags.other': '{n} sacos',
    'dash.empty': 'Vazio',
    'dash.noBagsOnRack': 'Nenhum saco nesta estante.',
    'dash.noBagsIn': 'Nenhum saco em {loc}.',
    'dash.bagsSelected.one': '{n} saco selecionado',
    'dash.bagsSelected.other': '{n} sacos selecionados',
    'dash.selectAll': 'Selecionar todos',
    'dash.clear': 'Limpar',
    'dash.move': 'Mover',
    'dash.remove': 'Remover',
    'dash.currentlyIn': 'Atualmente em {loc}',
    'dash.zones': 'Zonas',
    'dash.racks': 'Estantes',
    'dash.moveBags': 'Mover {n} saco(s)',
    'dash.zoneSpawn': 'Fase Spawn',
    'dash.zoneInc': 'Incuba\u00e7\u00e3o',
    'dash.zoneTent1': 'Tenda 1',
    'dash.zoneTent2': 'Tenda 2',
    'dash.zoneTent3': 'Tenda 3',
    'dash.zoneContam': 'Contaminado',
    'dash.fruitingTents': 'Tendas de Frutifica\u00e7\u00e3o',
    'dash.overdue': 'Atrasado',
    'dash.harvested': 'Colhido',
    'dash.rackN': 'Estante {n}',
    'dash.legend.title': 'Guia de cores',
    'dash.legend.species': 'Faixa colorida \u00e0 esquerda dos cart\u00f5es de lote — cada esp\u00e9cie tem sua pr\u00f3pria cor para identifica\u00e7\u00e3o r\u00e1pida.',
    'dash.legend.zoneDot': 'Ponto da zona nos cabe\u00e7alhos de se\u00e7\u00e3o — mostra a cor de cada local (configurado em Ferramentas \u2192 Zonas).',
    'dash.legend.orangeDot': 'Ponto laranja nas tarefas de lote — aviso, tarefa prestes a vencer ou precisa de aten\u00e7\u00e3o.',
    'dash.legend.redDot': 'Ponto vermelho nas tarefas de lote — urgente, atrasado ou a\u00e7\u00e3o cr\u00edtica necess\u00e1ria.',
    'dash.legend.overdue': 'Cart\u00e3o de lote com fundo rosa — lote atrasado (ap\u00f3s a data de vencimento, ainda em incuba\u00e7\u00e3o).',
    'dash.legend.capacity': 'Barra de capacidade vermelha — local excedeu sua capacidade m\u00e1xima configurada.',
    // Status
    'status.INCUBATING': 'INCUBANDO',
    'status.FRUITING': 'FRUTIFICANDO',
    'status.SPAWN_RUN': 'FASE SPAWN',
    'status.CONTAM': 'CONTAM.',
    'status.DONE': 'CONCLU\u00cdDO',
    'status.EMPTY': 'VAZIO',
    'status.action.harvest': 'Colher / verificar',
    'status.action.moveTent': 'Mover para tenda quando pronto',
    'status.action.monitorSpawn': 'Monitorar fase spawn',
    'status.action.discard': 'Descartar sacos',
    // Table headers - dashboard
    'th.batchId': 'ID do lote',
    'th.species': 'Esp\u00e9cie',
    'th.strain': 'Cepa',
    'th.total': 'Total',
    'th.harvested': 'Colhido',
    'th.due': 'Vencimento',
    'th.status': 'Status',
    'th.action': 'A\u00e7\u00e3o',
    // Bags
    'bags.one': '{n} saco',
    'bags.other': '{n} sacos',
    'bags.noBags': 'Nenhum saco nesta estante.',
    'bags.noBagsIn': 'Nenhum saco em {zone}.',
    'bags.selected.one': '{n} saco selecionado',
    'bags.selected.other': '{n} sacos selecionados',
    'bags.selectAll': 'Todos',
    'bags.clear': 'Limpar',
    'bags.move': 'Mover',
    'bags.remove': 'Remover',
    'bags.empty': 'Vazio',
    'bags.zones': 'Zonas',
    'bags.racks': 'Estantes',
    'bags.currentlyIn': 'Atualmente em {loc}',
    'bags.confirm': 'Confirmar',
    'bags.undo': 'Desfazer',
    'bags.undoSuccess': 'Desfeito com sucesso',
    // Batch page
    'batch.allBatches': 'Todos os lotes',
    'batch.newBatch': 'Novo lote',
    'batch.harvests': 'Colheitas',
    'batch.createNew': 'Criar novo lote',
    'batch.batchType': 'Tipo de lote',
    'batch.fruitingBlock': 'Bloco de frutifica\u00e7\u00e3o',
    'batch.grainSpawnBag': 'Saco de gr\u00e3os',
    'batch.bagWeight': 'Peso do saco',
    'batch.qty': 'Qtd (sacos)',
    'batch.incDays': 'Dias de incuba\u00e7\u00e3o',
    'batch.substrate': 'Substrato (opcional)',
    'batch.hardwood': 'Madeira dura %',
    'batch.wheatBran': 'Farelo de trigo %',
    'batch.fieldCapacity': 'Capacidade de campo %RH',
    'batch.gypsumAdded': 'Gesso adicionado',
    'batch.sourceCulture': 'Cultura de origem (opcional)',
    'batch.sourceCultureHint': 'Vincular \u00e0 PD ou LC usada para inocular este lote',
    'batch.none': '\u2014 nenhum \u2014',
    'batch.notes': 'Notas (opcional)',
    'batch.idPreview': 'Pr\u00e9via do ID do lote',
    'batch.create': 'Criar lote',
    'batch.generatedIds': 'IDs de sacos gerados',
    'batch.printLabels': 'Imprimir etiquetas para este lote',
    'batch.noBatches': 'Nenhum lote ainda.',
    'batch.noMatches': 'Sem resultados.',
    'batch.addNote': 'Adicionar nota',
    'batch.addBags': '+Sacos',
    'batch.del': 'Excluir',
    'batch.moveTo': 'Mover para',
    'batch.moveMenuTitle': 'Mover {id} para\u2026',
    'batch.noLocations': 'Nenhum local configurado',
    'batch.strainLabel': 'Cepa',
    'batch.strainPlaceholder': 'ex.: BHA-1, Amazing\u2026',
    'batch.whereGo': 'Para onde v\u00e3o esses sacos?',
    'batch.whereGoInfo': '{id} \u2014 {n} sacos precisam de um local inicial.',
    'batch.zones.rename': 'Renomear',
    'batch.zones.renamePrompt': 'Novo nome para \u201c{old}\u201d:',
    'batch.rename': 'Renomear ID',
    'batch.renameTitle': 'Renomear lote {id}',
    'batch.renameNewId': 'Novo ID do lote',
    'batch.renameWarning': 'Todos os sacos, log de scan e colheitas ser\u00e3o atualizados. Isso n\u00e3o pode ser desfeito.',
    'batch.renameBtn': 'Renomear',
    'batch.renameSuccess': 'Lote renomeado: {old} \u2192 {new}',
    'batch.deleteBatch': 'Excluir lote {id}?',
    'batch.deleteMsg': 'Exclui permanentemente o registro do lote. Log de scan e colheitas permanecem.',
    'batch.deleteBtn': 'Excluir lote',
    'batch.fillFields': 'Preencha esp\u00e9cie, cepa e quantidade',
    'batch.enterWeight': 'Insira o peso do saco',
    'batch.addBagsTo': 'Adicionar sacos ao lote',
    'batch.grainNeeded': 'Gr\u00e3os necess\u00e1rios:',
    'batch.inStock': 'Em estoque:',
    'batch.sufficient': 'suficiente',
    'batch.onlyEnoughFor': 'suficiente apenas para {n} sacos',
    'batch.bag': 'Saco:',
    'batch.dryMatterPerBag': 'Mat\u00e9ria seca por saco:',
    'batch.needed': 'necess\u00e1rio',
    'batch.shortBy': 'faltam',
    // Harvest
    'harvest.totalHarvested': 'Total colhido',
    'harvest.batchesWithYield': 'Lotes com rendimento',
    'harvest.topBatch': 'Melhor lote',
    'harvest.totalYieldPerBatch': 'Rendimento total por lote (g)',
    'harvest.overTime': 'Colheita ao longo do tempo (semanal, g)',
    'harvest.perBatchTotals': 'Totais por lote',
    'harvest.log': 'Registro de colheita',
    'harvest.searchBatch': 'Buscar lote...',
    'harvest.noHarvests': 'Nenhuma colheita ainda. Escaneie HARVEST e depois um saco.',
    'harvest.noData': 'Sem dados de colheita ainda.',
    'harvest.logged': 'Colheita registrada: {bag} \u2192 {g}g (flush {f})',
    'harvest.bagScanned': 'Saco escaneado: {bag} \u2192 insira gramas acima e pressione Enter',
    // Table headers - harvest
    'th.date': 'Data',
    'th.batch': 'Lote',
    'th.bag': 'Saco',
    'th.flush': 'Flush',
    'th.grams': 'Gramas',
    // Table headers - batch list
    'th.qty': 'Qtd',
    'th.inc': 'Inc.',
    'th.substrate': 'Substrato',
    'th.source': 'Origem',
    'th.created': 'Criado',
    'th.notes': 'Notas',
    // Lab
    'lab.cultures': 'Culturas',
    'lab.logWork': 'Registrar trabalho',
    'lab.lineage': 'Linhagem',
    'lab.cultureLibrary': 'Biblioteca de culturas',
    'lab.allTypes': 'Todos os tipos',
    'lab.motherCultures': 'Culturas m\u00e3e',
    'lab.petriDishes': 'Placas de Petri',
    'lab.liquidCultures': 'Culturas l\u00edquidas',
    'lab.allStatuses': 'Todos os status',
    'lab.active': 'Ativa',
    'lab.stored': 'Armazenada',
    'lab.usedUp': 'Esgotada',
    'lab.contaminated': 'Contaminada',
    'lab.deleteCulture': 'Excluir cultura',
    'lab.deleteCultureTitle': 'Excluir cultura?',
    'lab.deleteCultureMsg': 'A cultura {id} ser\u00e1 permanentemente exclu\u00edda.',
    'lab.deleteChildren': '{n} cultura(s) descendente(s) referenciam esta cultura.',
    'lab.deleteBatches': '{n} lote(s) referenciam esta cultura.',
    'lab.deleteRefWarn': 'A refer\u00eancia pai/origem ficar\u00e1 inv\u00e1lida.',
    'lab.noCultures': 'Nenhuma cultura ainda. Use Laborat\u00f3rio \u2192 Registrar trabalho.',
    'lab.logCleanRoom': 'Registrar trabalho em sala limpa',
    'lab.workType': 'Tipo de trabalho',
    'lab.registerMC': 'Registrar cultura m\u00e3e',
    'lab.pdTransfer': 'Transfer\u00eancia de placa de Petri',
    'lab.lcPrep': 'Preparo de cultura l\u00edquida',
    'lab.g2g': 'Gr\u00e3o-a-gr\u00e3o (G2G)',
    'lab.parentCulture': 'Cultura m\u00e3e',
    'lab.parentMCPDLC': 'Origem (MC, PD ou LC)',
    'lab.sourcePDMC': 'Origem (placa de Petri ou MC)',
    'lab.noneNewIsolation': '\u2014 nenhuma / novo isolamento \u2014',
    'lab.source': 'Origem (ex. clone, impress\u00e3o de esporos, selvagem)',
    'lab.qtyMade': 'Quantidade produzida',
    'lab.qtyTubes': 'Quantidade (tubos/placas)',
    'lab.numDishes': 'N\u00famero de placas',
    'lab.numFlasks': 'N\u00famero de frascos',
    'lab.numBags': 'N\u00famero de sacos',
    'lab.observations': 'Observa\u00e7\u00f5es, condi\u00e7\u00f5es...',
    'lab.idsCreated': 'IDs que ser\u00e3o criados',
    'lab.logWorkBtn': 'Registrar trabalho',
    'lab.recentEntries': 'Entradas recentes do lab',
    'lab.noWork': 'Nenhum trabalho de lab registrado ainda.',
    'lab.enterSpecies': 'Insira uma esp\u00e9cie',
    'lab.selectPilzsorte': 'Selecione uma Pilzsorte',
    'lab.g2gNote': 'G2G \u00e9 registrado pela barra de scan \u2014 use ADD.',
    'lab.printNow': 'Imprimir etiquetas agora?',
    'lab.qtyDishes': 'N\u00famero de placas',
    'lab.qtyFlasks': 'N\u00famero de frascos',
    'lab.qtyBags': 'N\u00famero de sacos',
    'lab.parentMcPdLc': 'Origem (MC, PD ou LC)',
    'lab.sourcePdMc': 'Fonte (placa de Petri ou MC)',
    'lab.logged': 'Registrado: {n} {type} criado(s)',
    'lab.noLabWork': 'Nenhum trabalho de laborat\u00f3rio registrado.',
    'lab.geneticLineage': 'Linhagem gen\u00e9tica',
    'lab.selectCultureBatch': '\u2014 selecionar cultura ou lote \u2014',
    'lab.selectAbove': 'Selecione uma cultura ou lote acima para rastrear linhagem.',
    'lab.selectAboveShort': 'Selecione uma cultura ou lote acima.',
    'lab.noLineageData': 'Nenhum dado de linhagem encontrado.',
    'lab.grainSpawn': 'Gr\u00e3os de spawn',
    'lab.createGrainSpawn': 'Criar sacos de gr\u00e3os de spawn',
    'lab.grainIdPreview': 'Pr\u00e9via do ID de gr\u00e3os',
    'lab.createGrainBtn': 'Criar gr\u00e3os de spawn',
    'lab.grainCreated': '{n} sacos de gr\u00e3os criados',
    // Table headers - lab
    'th.id': 'ID',
    'th.type': 'Tipo',
    'th.parent': 'Origem',
    // Print
    'print.printerInfo': 'Imprimindo diretamente na ZDesigner GK420d',
    'print.printerInfoDetail': 'via servidor \u2014 sem di\u00e1logo. Certifique-se de que o servidor est\u00e1 rodando e a impressora ligada.',
    'print.bagLabels': 'Etiquetas de sacos',
    'print.labLabels': 'Etiquetas de lab',
    'print.refBarcodes': 'C\u00f3digos de refer\u00eancia',
    'print.selectBatch': 'Selecionar lote',
    'print.chooseBatch': '\u2014 escolher lote \u2014',
    'print.labelContent': 'Conte\u00fado da etiqueta',
    'print.barcodeIdOnly': 'C\u00f3digo + apenas ID',
    'print.barcodeIdSpecies': 'C\u00f3digo + ID + cepa/substrato',
    'print.barcodeIdDate': 'C\u00f3digo + ID + cepa/substrato + vencimento',
    'print.printRange': 'Intervalo de impress\u00e3o',
    'print.allBags': 'Todos os sacos',
    'print.bagRange': 'Intervalo de sacos (de\u2013at\u00e9)',
    'print.printDirect': 'Imprimir etiquetas (direto)',
    'print.preview': 'Pr\u00e9via',
    'print.selectBatchAbove': 'Selecione um lote acima.',
    'print.filterCultures': 'Filtrar culturas',
    'print.allActiveCultures': 'Todas as culturas ativas',
    'print.createdToday': 'Criadas hoje',
    'print.labelIncludes': 'Etiqueta inclui',
    'print.code128barcode': 'C\u00f3digo de barras Code 128',
    'print.qrCode': 'C\u00f3digo QR',
    'print.speciesStrain': 'Esp\u00e9cie + cepa',
    'print.parentId': 'ID de origem',
    'print.dateCreated': 'Data de cria\u00e7\u00e3o',
    'print.printLabDirect': 'Imprimir etiquetas (direto)',
    'print.noCultureMatch': 'Nenhuma cultura encontrada.',
    'print.tickCultures': 'Marque culturas na lista para pr\u00e9via de etiquetas.',
    'print.refBarcodesTitle': 'C\u00f3digos de refer\u00eancia \u2014 imprimir e pendurar na parede',
    'print.qrCodes': 'C\u00f3digos QR',
    'print.printSheet': 'Imprimir folha',
    'print.scanInfo': 'Escanear funciona em todas as abas \u2014 escaneie desta folha a qualquer momento.',
    'print.selectBatchFirst': 'Selecione um lote primeiro.',
    'print.noBagsInRange': 'Nenhum saco neste intervalo.',
    'print.selectCulture': 'Selecione pelo menos uma cultura.',
    // To-do
    'todo.tasks': 'Tarefas',
    'todo.team': 'Equipe',
    'todo.calendar': 'Calend\u00e1rio',
    'todo.batchTasks': 'Tarefas dos lotes',
    'todo.all': 'Todas',
    'todo.urgentOnly': 'Apenas urgentes',
    'todo.manualTasks': 'Tarefas manuais',
    'todo.add': '+ Adicionar',
    'todo.task': 'Tarefa',
    'todo.priority': 'Prioridade',
    'todo.low': 'Baixa',
    'todo.medium': 'M\u00e9dia',
    'todo.high': 'Alta',
    'todo.assignTo': 'Atribuir a',
    'todo.everyone': 'Todos (empresa)',
    'todo.dueDate': 'Data de vencimento (opcional)',
    'todo.description': 'Descri\u00e7\u00e3o (opcional)',
    'todo.save': 'Salvar',
    'todo.openTasks': 'Tarefas abertas',
    'todo.urgent': 'Urgentes',
    'todo.comingUp': 'Pr\u00f3ximas',
    'todo.noTasks': 'Nenhuma tarefa!',
    'todo.noManualTasks': 'Nenhuma tarefa manual.',
    'todo.dueAgo': 'Vencido h\u00e1 {n} dia(s)',
    'todo.dueIn': 'Vence em {n} dia(s)',
    'todo.fruiting': 'frutificando',
    'todo.deleteTask': 'Excluir tarefa?',
    'todo.deleteTaskMsg': 'Esta tarefa ser\u00e1 removida permanentemente.',
    'todo.delete': 'Excluir',
    'todo.everyone_tag': 'Todos',
    // Days
    'days.ago.one': 'Venceu h\u00e1 {n} dia',
    'days.ago.other': 'Venceu h\u00e1 {n} dias',
    'days.in.one': 'Vence em {n} dia',
    'days.in.other': 'Vence em {n} dias',
    'days.inDays': 'Vence em {n} dias',
    // Team
    'team.members': 'Membros da equipe',
    'team.membersDesc': 'Adicione membros da equipe para atribuir tarefas individualmente. Cada membro pode ter seu pr\u00f3prio calend\u00e1rio CalDAV.',
    'team.noMembers': 'Nenhum membro ainda. Adicione o primeiro abaixo.',
    'team.name': 'Nome',
    'team.role': 'Fun\u00e7\u00e3o (opcional)',
    'team.addMember': '+ Adicionar membro',
    'team.removeMember': 'Remover membro?',
    'team.removeMsg': 'Remover {name} da equipe. Atribui\u00e7\u00f5es existentes permanecem.',
    'team.removeBtn': 'Remover',
    // CalDAV
    'caldav.title': 'Servidor de calend\u00e1rio CalDAV',
    'caldav.desc': 'Este servidor inclui um servidor CalDAV. Conecte um app de calend\u00e1rio (Apple Calendar, Thunderbird, DAVx5 no Android) para ver suas tarefas.',
    'caldav.urlTitle': 'URL CalDAV (use no seu app de calend\u00e1rio)',
    'caldav.password': 'Opcional: proteger com senha',
    'caldav.username': 'Usu\u00e1rio',
    'caldav.userPlaceholder': 'deixe vazio para acesso aberto',
    'caldav.passPlaceholder': 'deixe vazio para acesso aberto',
    'caldav.enableSync': 'Ativar sincroniza\u00e7\u00e3o (enviar tarefas para calend\u00e1rios)',
    'caldav.perPerson': 'Calend\u00e1rio separado por pessoa',
    'caldav.saveSettings': 'Salvar configura\u00e7\u00f5es',
    'caldav.syncNow': 'Sincronizar todas as tarefas agora',
    'caldav.settingsSaved': 'Configura\u00e7\u00f5es salvas.',
    'caldav.enableFirst': 'Ative a sincroniza\u00e7\u00e3o primeiro e salve as configura\u00e7\u00f5es.',
    'caldav.syncing': 'Sincronizando...',
    'caldav.writingTasks': 'Escrevendo tarefas nos arquivos de calend\u00e1rio...',
    'caldav.howToConnect': 'Como conectar',
    'caldav.howItWorks': 'Como funciona',
    // More / Settings
    'settings.scanLog': 'Log de scan',
    'settings.user': 'Usuário',
    'settings.backup': 'Backup',
    'settings.clear': 'Limpar',
    'settings.noScans': 'Nenhum scan ainda.',
    'settings.clearLog': 'Limpar todo o log de scan?',
    'settings.clearLogMsg': 'Exclui permanentemente todas as {n} entradas de scan. Lotes e colheitas n\u00e3o s\u00e3o exclu\u00eddos.',
    'settings.clearLogBtn': 'Sim, limpar tudo',
    'settings.downloadBackupTitle': 'Baixar backup',
    'settings.downloadBackupDesc': 'Baixar um backup completo protegido por senha. Salve em USB, nuvem ou envie por e-mail.',
    'settings.downloadBackupBtn': 'Baixar backup',
    'settings.restoreBackupTitle': 'Restaurar backup',
    'settings.restoreDescHtml': 'Restaurar de um arquivo de backup criptografado. <strong style="color:var(--c-red-dark)">Substitui todos os dados atuais para todos os usuários.</strong>',
    'settings.restoreBtn': 'Restaurar',
    'settings.syncInfo': 'Info de sincronização',
    'settings.syncInfoDesc': 'Todos os dados são armazenados no servidor \u2014 compartilhado automaticamente por todos os dispositivos. Mudanças sincronizam a cada 5 segundos. Clique no ponto verde para sincronizar imediatamente.',
    'settings.restoreBackup': 'Restaurar este backup?',
    'settings.restoreMsg': 'Substitui TODOS os dados no servidor para todos os usuários. Não pode ser desfeito.',
    'settings.restoreConfirm': 'Sim, restaurar',
    'settings.invalidFile': 'Arquivo inv\u00e1lido.',
    'settings.cannotRead': 'N\u00e3o foi poss\u00edvel ler o arquivo.',
    // Table headers - scan log
    'th.time': 'Hora',
    // Sync
    'sync.syncing': 'Sincronizando...',
    'sync.synced': 'Sincronizado {time}',
    'sync.saving': 'Salvando...',
    'sync.saved': 'Salvo {time}',
    'sync.error': 'Erro de sincroniza\u00e7\u00e3o',
    'sync.saveError': 'Erro ao salvar \u2014 verifique se o servidor est\u00e1 rodando',
    'sync.clickToSync': 'Clique para sincronizar',
    // Inventory
    'inv.stock': 'Estoque',
    'inv.logDelivery': 'Registrar entrega',
    'inv.usageLog': 'Hist\u00f3rico de uso',
    'inv.alertThresholds': 'Limites de alerta',
    'inv.alertThresholdsDesc': 'Defina o n\u00edvel m\u00ednimo de estoque para alerta. Defina tamb\u00e9m o tamanho padr\u00e3o do saco para calcular "suficiente para X sacos".',
    'inv.lowStock': 'ESTOQUE BAIXO',
    'inv.alertBelow': 'Alerta abaixo de {n}kg',
    'inv.logDeliveryBtn': '+ Registrar entrega',
    'inv.logIncoming': 'Registrar entrega recebida',
    'inv.material': 'Material',
    'inv.currentStock': 'Estoque atual: {n} kg',
    'inv.amountReceived': 'Quantidade recebida (kg)',
    'inv.supplierNote': 'Fornecedor / nota (opcional)',
    'inv.addToStock': 'Adicionar ao estoque',
    'inv.afterDelivery': 'Ap\u00f3s entrega:',
    'inv.manualAdj': 'Ajuste manual',
    'inv.manualAdjDesc': 'Use para corrigir estoque ap\u00f3s contagem f\u00edsica, deteriora\u00e7\u00e3o ou discrep\u00e2ncia.',
    'inv.setStockTo': 'Definir estoque para (kg)',
    'inv.orAddSubtract': 'ou adicionar / subtrair',
    'inv.adjustBy': 'Ajustar em (kg) \u2014 negativo para subtrair',
    'inv.reason': 'Motivo',
    'inv.apply': 'Aplicar',
    'inv.usageHistory': 'Hist\u00f3rico de uso de material',
    'inv.allMaterials': 'Todos os materiais',
    'inv.noUsageHistory': 'Sem hist\u00f3rico de uso ainda.',
    'inv.enterQty': 'Insira uma quantidade maior que 0',
    'inv.enterAmount': 'Insira um novo total ou valor de ajuste',
    'inv.grainBags': '\u2248 {n} sacos de gr\u00e3os @ {kg}kg cada',
    'inv.blocks': '\u2248 <strong>{n}</strong> \u00d7 {kg}kg blocos <span style="font-size:10px;color:var(--c-text-muted)">(estimativa)</span>',
    'inv.avgComposition': 'Composi\u00e7\u00e3o m\u00e9dia para estimativas',
    'inv.avgCompDesc': 'Estas m\u00e9dias calculam "\u007eX sacos" nos cart\u00f5es de estoque. S\u00e3o apenas <strong>estimativas</strong> \u2014 o uso exato \u00e9 rastreado ao criar um lote com receita espec\u00edfica.',
    'inv.hardwoodPct': 'Madeira dura %',
    'inv.wheatBranPct': 'Farelo de trigo %',
    'inv.waterPct': '\u00c1gua % (RH)',
    'inv.blockWeight': 'Peso do bloco (kg)',
    'inv.grainBagKg': 'Saco de gr\u00e3os (kg)',
    'inv.lowStockAlert': 'Estoque baixo: {mat}',
    // Material labels
    'mat.hardwood': 'Pellets de madeira dura',
    'mat.wheatbran': 'Farelo de trigo',
    'mat.gypsum': 'Gesso',
    'mat.grain': 'Gr\u00e3os',
    // Table headers - inventory
    'th.material': 'Material',
    'th.inStock': 'Em estoque',
    'th.alertBelow': 'Alerta abaixo (kg)',
    'th.estBags': 'Est. sacos (m\u00e9d.)',
    // Assets
    'assets.overview': 'Vis\u00e3o geral',
    'assets.add': 'Adicionar',
    'assets.labels': 'Etiquetas',
    'assets.export': 'Exportar',
    'assets.title': 'Invent\u00e1rio de ativos',
    'assets.name': 'Nome',
    'assets.category': 'Categoria',
    'assets.purchasePrice': 'Pre\u00e7o de compra',
    'assets.bookValue': 'Valor cont\u00e1bil',
    'assets.location': 'Localiza\u00e7\u00e3o',
    'assets.actions': 'A\u00e7\u00f5es',
    'assets.total': 'Total',
    'assets.purchaseValueActive': 'Valor de aquisi\u00e7\u00e3o (ativos)',
    'assets.bookValueToday': 'Valor cont\u00e1bil hoje (ativos)',
    'assets.noAssets': 'Nenhum ativo registrado. Clique em "Adicionar" para come\u00e7ar.',
    'assets.edit': 'Editar',
    'assets.print': 'Impr.',
    'assets.addAsset': 'Registrar ativo',
    'assets.entryDate': 'Data de entrada',
    'assets.usefulLife': 'Vida \u00fatil (anos)',
    'assets.depMethod': 'M\u00e9todo de deprecia\u00e7\u00e3o',
    'assets.linear': 'Linear',
    'assets.supplier': 'Fornecedor',
    'assets.invoiceNr': 'N\u00ba da fatura',
    'assets.serialNr': 'N\u00ba de s\u00e9rie',
    'assets.exitDate': 'Data de sa\u00edda',
    'assets.saveBtn': 'Salvar',
    'assets.resetBtn': 'Resetar',
    'assets.newId': 'Novo ID: {id}',
    'assets.editing': 'Editando: {id}',
    'assets.fillRequired': 'Preencha todos os campos obrigat\u00f3rios.',
    'assets.deleteAsset': 'Excluir ativo?',
    'assets.deleteMsg': 'O ativo {id} ser\u00e1 exclu\u00eddo permanentemente.',
    'assets.deleteBtn': 'Sim, excluir',
    'assets.csvExport': 'Exportar CSV',
    'assets.csvDesc': 'Lista completa de invent\u00e1rio com todos os campos e valores de deprecia\u00e7\u00e3o calculados em CSV.',
    'assets.exportCsv': 'Exportar CSV',
    'assets.cutoffInv': 'Invent\u00e1rio na data de refer\u00eancia',
    'assets.cutoffDate': 'Data de refer\u00eancia',
    'assets.calculate': 'Calcular',
    'assets.chooseCutoff': 'Escolha uma data de refer\u00eancia.',
    'assets.printLabels': 'Imprimir etiquetas de invent\u00e1rio',
    'assets.all': 'Todos',
    'assets.none': 'Nenhum',
    'assets.printBtn': 'Imprimir',
    'assets.downloadZPL': 'Baixar ZPL',
    'assets.noAssetsAvail': 'Nenhum ativo dispon\u00edvel.',
    'assets.selectAsset': 'Selecione pelo menos um ativo.',
    'assets.printError': 'Erro de impress\u00e3o: ',
    // Asset categories
    'assets.cat.Maschinen': 'M\u00e1quinas',
    'assets.cat.B\u00fcroausstattung': 'Equipamento de escrit\u00f3rio',
    'assets.cat.EDV': 'Equipamento de TI',
    'assets.cat.Labor': 'Laborat\u00f3rio',
    'assets.cat.Fahrzeuge': 'Ve\u00edculos',
    'assets.cat.Sonstiges': 'Outros',
    // Asset statuses
    'assets.status.aktiv': 'Ativo',
    'assets.status.ausgeschieden': 'Retirado',
    'assets.status.verkauft': 'Vendido',
    'assets.status.verschrottet': 'Sucateado',
    // CSV headers
    'csv.invNr': 'N\u00ba do ativo',
    'csv.name': 'Nome',
    'csv.category': 'Categoria',
    'csv.entryDate': 'Data de entrada',
    'csv.purchaseCost': 'Custo de aquisi\u00e7\u00e3o',
    'csv.usefulLife': 'Vida \u00fatil (a.)',
    'csv.annualDepr': 'Depr. anual',
    'csv.accumDepr': 'Depr. acum.',
    'csv.bookValue': 'Valor cont\u00e1bil',
    'csv.gwg': 'GWG',
    'csv.status': 'Status',
    'csv.supplier': 'Fornecedor',
    'csv.invoiceNr': 'N\u00ba fatura',
    'csv.serialNr': 'N\u00ba s\u00e9rie',
    'csv.location': 'Localiza\u00e7\u00e3o',
    'csv.exitDate': 'Data de sa\u00edda',
    'csv.remarks': 'Observa\u00e7\u00f5es',
    'csv.yes': 'Sim',
    'csv.no': 'N\u00e3o',
    // Cutoff report
    'cutoff.date': 'Data de refer\u00eancia: {date} \u2014 {n} ativos ativos',
    'cutoff.nr': 'N\u00ba',
    'cutoff.purchaseCost': 'Custo de aquisi\u00e7\u00e3o',
    'cutoff.accumDepr': 'Depr. acum.',
    'cutoff.sum': 'Soma',
    // Bag info modal
    'bagInfo.currentLocation': 'Localiza\u00e7\u00e3o atual',
    'bagInfo.notPlaced': 'Ainda n\u00e3o colocado',
    'bagInfo.removed': 'Removido',
    'bagInfo.noneYet': 'Nenhuma ainda',
    'bagInfo.allBags': 'Todos os sacos',
    'bagInfo.addThisBag': '+ ADICIONAR este saco',
    'bagInfo.moveThisBag': 'MOVER este saco',
    'bagInfo.harvestThisBag': 'COLHER este saco',
    'bagInfo.removeThisBag': 'X REMOVER este saco',
    // Confirm modal
    'confirm.confirm': 'Confirmar',
    'confirm.cancel': 'Cancelar',
    // Note modal
    'note.title': 'Nota \u2014 {id}',
    'note.save': 'Salvar',
    'note.cancel': 'Cancelar',
    // Scan feedback
    'scanFb.actionAdd': 'A\u00e7\u00e3o: ADD \u2192 escaneie local/estante, depois sacos',
    'scanFb.actionMove': 'A\u00e7\u00e3o: MOVE \u2192 escaneie local de destino, depois sacos',
    'scanFb.actionRemove': 'A\u00e7\u00e3o: REMOVE \u2192 escaneie sacos',
    'scanFb.actionHarvest': 'A\u00e7\u00e3o: HARVEST \u2192 escaneie um saco para registrar peso',
    'scanFb.location': 'Local: {loc} \u2192 agora escaneie sacos',
    'scanFb.from': 'De: {loc} \u2192 escaneie o local PARA',
    'scanFb.to': 'Para: {loc} \u2192 agora escaneie sacos',
    'scanFb.setAction': 'Defina uma a\u00e7\u00e3o primeiro \u2014 escaneie ADD, MOVE, REMOVE ou HARVEST.',
    'scanFb.scanLocFirst': 'Escaneie um local ou estante primeiro.',
    'scanFb.scanFromTo': 'Escaneie os locais DE e PARA primeiro.',
    'scanFb.scanToFirst': 'Escaneie o local de destino primeiro.',
    'scanFb.logged': 'Registrado: {action} {val}{to} [{n} nesta sess\u00e3o]',
    'scanFb.bagNotPlaced': '{bag} n\u00e3o tem local conhecido \u2014 use ADD primeiro',
    'scanFb.bagRemoved': '{bag} foi removido \u2014 use ADD para recolocar',
    'scanFb.bagAlreadyAt': '{bag} j\u00e1 est\u00e1 em {loc}',
    'scanFb.unknown': 'C\u00f3digo desconhecido: {val}. Verifique se o lote existe.',
    'scanFb.matched': 'Correspondido: {val} de {batch}',
    'scanFb.noBatchFound': 'Nenhum lote encontrado para {val} \u2014 verifique esp\u00e9cie/cepa/data',
    'scanFb.removeLogged': 'REMOVE registrado: {bag}',
    'scanFb.actionReady': '{action} pronto \u2014 escaneie um local, depois mais sacos',
    'scanFb.bagInfo': 'Info do saco: {bag} \u2014 escolha uma a\u00e7\u00e3o abaixo ou feche',
    'scanFb.cultureScanned': 'Cultura escaneada: {val} \u2192 visualiza\u00e7\u00e3o de linhagem',
    'scanFb.moved': '{n} movido(s) \u2192 {loc}',
    'scanFb.removed': '{n} removido(s)',
    'scanFb.confirmRemove': 'Remover {n}?',
    // Batch add modal
    'batchAdd.title': 'Adicionar sacos ao lote',
    'batchAdd.willLog': 'Registrar\u00e1 {n} sacos \u2192 {loc}',
    'batchAdd.selectFirst': 'Selecione um lote primeiro',
    'batchAdd.batchAdd': 'ADD do lote: {n} sacos \u2192 {loc}',
    // Add bags modal
    'addBags.title': 'Adicionar sacos',
    'addBags.info': '{id} tem atualmente {n} sacos ({last} \u00e9 o \u00faltimo)',
    'addBags.enterQty': 'Insira pelo menos 1',
    'addBags.added': '{qty} adicionados a {id} (agora {total} no total)',
    'addBags.addedTitle': 'Sacos adicionados',
    'addBags.howMany': 'Quantos sacos adicionar',
    'addBags.printLabels': 'Imprimir etiquetas',
    'addBags.printed': '{n} etiquetas impressas para {id}',
    'addBags.close': 'Fechar',
    // Delivery/adjustment feedback
    'inv.deliveryLogged': 'Entrega registrada: +{kg}kg {mat} agora {total}kg total',
    'inv.adjusted': '{mat} ajustado: {delta}kg agora {total}kg total',
    'inv.suppliers': 'Fornecedores',
    'inv.suppliersDesc': 'Gerencie fornecedores para cada material para saber onde reabastecer.',
    'inv.addSupplier': 'Adicionar fornecedor',
    'inv.supplierName': 'Nome',
    'inv.supplierUrl': 'Site',
    'inv.supplierPhone': 'Telefone',
    'inv.supplierNotes': 'Notas',
    'inv.noSuppliers': 'Nenhum fornecedor adicionado ainda.',
    'inv.reorderFrom': 'Reabastecer de',
    'inv.editSupplier': 'Editar',
    'inv.deleteSupplier': 'Excluir',
    'inv.supplierSaved': 'Fornecedor salvo',
    'inv.supplierDeleted': 'Fornecedor exclu\u00eddo',
    // Print feedback
    'print.printed': '{n} etiquetas impressas para {id}',
    'print.printedLabels': '{n} etiqueta(s) de lab impressa(s)',
    'print.assetLabelsPrinted.one': '{n} etiqueta de invent\u00e1rio impressa',
    'print.assetLabelsPrinted.other': '{n} etiquetas de invent\u00e1rio impressas',
    // CalDAV feedback
    'caldav.done': 'Conclu\u00eddo! {n} tarefas escritas no calend\u00e1rio.{errors} Apps de calend\u00e1rio podem v\u00ea-las via CalDAV.',
    'caldav.syncFail': 'Sincroniza\u00e7\u00e3o falhou: {err}',
    'caldav.syncError': 'Erro de sincroniza\u00e7\u00e3o: {err}',
    // Backup validation
    'settings.valid': 'V\u00e1lido: {date} \u2014 {batches} lotes, {scans} scans, {cultures} culturas, invent\u00e1rio: {inv}.',
    // Static HTML keys
    'batch.batchId': 'ID do lote',
    'batch.species': 'Esp\u00e9cie',
    'batch.strain': 'Cepa',
    'batch.notFound': 'Lote n\u00e3o encontrado',
    'nav.cancel': 'Cancelar',
    'settings.time': 'Hora',
    'settings.action': 'A\u00e7\u00e3o',
    'settings.bag': 'Saco',
    'settings.from': 'De',
    'settings.to': 'Para',
    'settings.restoreDescHtml': 'Restaurar de um arquivo de backup criptografado. <strong style="color:var(--c-red-dark)">Substitui todos os dados atuais para todos os usuários.</strong>',
    'mcp.title': 'Servidor MCP',
    'mcp.desc': 'Permite que o Claude e outros assistentes de IA acessem o banco de dados do MeisterTracker via Model Context Protocol. O Claude conecta automaticamente via OAuth \u2014 basta colar a URL.',
    'mcp.enable': 'Ativar servidor MCP',
    'mcp.connectorUrl': 'URL do Connector',
    'mcp.copy': 'Copiar',
    'mcp.apiKey': 'Chave de API (scripts / automação)',
    'mcp.generateKey': 'Gerar chave de API',
    'mcp.keyHint': 'Para scripts ou ferramentas que não suportam OAuth. Use como Bearer token no header Authorization. A chave é exibida apenas uma vez.',
    'mcp.save': 'Salvar',
    'mcp.active': 'Servidor MCP ativo',
    'mcp.noKey': 'MCP ativado \u2014 pronto para conectar via OAuth.',
    'mcp.sessions': 'Servidor MCP ativo \u2014 {n} sessão(ões)',
    'mcp.urlCopied': 'URL copiada!',
    'mcp.keyCopied': 'Chave copiada!',
    'mcp.keyGenerated': 'Chave de API gerada. Copie agora!',
    'mcp.saved': 'Configurações salvas.',
    'mcp.error': 'Erro: {msg}',
    'mcp.guideTitle': 'Guia de configuração',
    'mcp.diagTitle': 'Diagnóstico',
    'mcp.runDiag': 'Executar diagnóstico',
    'mcp.diagRunning': 'Executando diagnóstico...',
    'mcp.diagFailed': 'Falha no diagnóstico',
    'mcp.diagAutoClients': 'Clientes auto-registrados',
    'mcp.diagManualClients': 'Clientes manuais',
    'mcp.diagSessions': 'Sessões MCP ativas',
    'mcp.oauthTitle': 'Clientes Conectados',
    'mcp.oauthDesc': 'Clientes conectados via OAuth. O Claude se registra automaticamente ao adicionar a URL do connector.',
    'mcp.noClients': 'Nenhum cliente conectado ainda. Conecte o Claude colando a URL acima.',
    'mcp.clientName': 'Nome',
    'mcp.unnamed': '(sem nome)',
    'mcp.created': 'Criado',
    'mcp.activeSessions': 'Sessões',
    'mcp.deleteClient': 'Excluir',
    'mcp.confirmDelete': 'Excluir este cliente? Todas as sessões ativas serão revogadas.',
    'mcp.confirmDeleteAuto': 'Revogar este cliente auto-registrado? O Claude registrará um novo cliente na próxima conexão.',
    'mcp.clientDeleted': 'Cliente excluído.',
    'mcp.step1': '1. Ativar servidor MCP e salvar',
    'mcp.step2': '2. Copiar a URL do connector acima',
    'mcp.step3': '3. No Claude: Configurações \u2192 Connectors \u2192 Adicionar \u2192 colar a URL',
    'mcp.step4': '4. Faça login quando solicitado \u2014 pronto! O Claude conecta automaticamente via OAuth.',
    'mcp.features': 'Funções disponíveis: Briefing diário, gerenciar lotes, tarefas, calendário, inventário, colheitas, culturas, visão geral das zonas',
    'todo.taskPlaceholder': 'ex. Limpar tenda de umidade',
    'todo.descPlaceholder': 'Detalhes adicionais...',
    'inv.hardwood': 'Pellets de madeira dura',
    'inv.wheatBran': 'Farelo de trigo',
    'inv.gypsum': 'Gesso',
    'inv.grain': 'Gr\u00e3os',
    'inv.date': 'Data',
    'inv.changeKg': 'Altera\u00e7\u00e3o (kg)',
    'inv.runningTotal': 'Total acumulado',
    'inv.type': 'Tipo',
    'inv.reference': 'Refer\u00eancia',
    'asset.overview': 'Vis\u00e3o geral',
    'asset.addNew': 'Adicionar',
    'asset.export': 'Exportar',
    'asset.labels': 'Etiquetas',
    'asset.inventory': 'Invent\u00e1rio de ativos',
    'asset.allCategories': 'Todas as categorias',
    'asset.allStatus': 'Todos os status',
    'asset.cat.machinery': 'M\u00e1quinas',
    'asset.cat.office': 'Equipamento de escrit\u00f3rio',
    'asset.cat.it': 'Equipamento de TI',
    'asset.cat.lab': 'Laborat\u00f3rio',
    'asset.cat.vehicles': 'Ve\u00edculos',
    'asset.cat.other': 'Outros',
    'asset.status.aktiv': 'Ativo',
    'asset.status.ausgeschieden': 'Aposentado',
    'asset.status.verkauft': 'Vendido',
    'asset.status.verschrottet': 'Sucateado',
    'asset.nr': 'Nr',
    'asset.name': 'Nome',
    'asset.category': 'Categoria',
    'asset.purchasePrice': 'Pre\u00e7o de compra',
    'asset.bookValue': 'Valor cont\u00e1bil',
    'asset.status': 'Status',
    'asset.location': 'Local',
    'asset.actions': 'A\u00e7\u00f5es',
    'asset.recordAsset': 'Registrar ativo',
    'asset.designation': 'Designa\u00e7\u00e3o *',
    'asset.designationPh': 'ex. Autoclave 50L',
    'asset.acquisitionDate': 'Data de aquisi\u00e7\u00e3o *',
    'asset.netPrice': 'Pre\u00e7o de compra (\u20ac l\u00edquido) *',
    'asset.usefulLife': 'Vida \u00fatil (anos) *',
    'asset.deprMethod': 'M\u00e9todo de deprecia\u00e7\u00e3o',
    'asset.linear': 'Linear',
    'asset.supplier': 'Fornecedor',
    'asset.supplierPh': 'Nome da empresa',
    'asset.invoiceNr': 'N\u00famero da fatura',
    'asset.serialNr': 'N\u00famero de s\u00e9rie',
    'asset.locationPh': 'ex. Laborat\u00f3rio, Escrit\u00f3rio',
    'asset.exitDate': 'Data de sa\u00edda',
    'asset.notes': 'Notas',
    'asset.save': 'Salvar',
    'asset.reset': 'Redefinir',
    'asset.csvExport': 'Exportar CSV',
    'asset.csvExportDesc': 'Lista completa de invent\u00e1rio com todos os campos e valores de deprecia\u00e7\u00e3o calculados como CSV para o contador.',
    'asset.exportCsv': 'Exportar CSV',
    'asset.cutoffInventory': 'Invent\u00e1rio de data de corte',
    'asset.cutoffDate': 'Data de corte',
    'asset.calculate': 'Calcular',
    'asset.printLabels': 'Imprimir etiquetas de invent\u00e1rio',
    'asset.selectAll': 'Todos',
    'asset.selectNone': 'Nenhum',
    'asset.print': 'Imprimir',
    'asset.downloadZpl': 'Baixar ZPL',
    // Zones
    'zones.title': 'Zonas & Racks',
    'zones.desc': 'Gerencie os locais da sua fazenda. Zonas só podem ser excluídas quando vazias.',
    'zones.addTitle': 'Adicionar zona',
    'zones.zoneName': 'Nome',
    'zones.zoneRole': 'Função',
    'zones.zoneColor': 'Cor',
    'zones.zoneRacks': 'Racks (opcional, separados por vírgula)',
    'zones.add': 'Adicionar zona',
    'zones.delete': 'Excluir',
    'zones.deleteTitle': 'Excluir zona?',
    'zones.deleteMsg': 'Zona "{name}" e todos os racks serão removidos.',
    'zones.noRacks': 'Sem racks',
    'zones.rackPrompt': 'Nome do rack (ex. R3):',
    'zones.errShort': 'Nome da zona muito curto (mín. 2 caracteres)',
    'zones.errExists': 'Zona já existe',
    'zones.errRackExists': 'Rack já existe',
    'zones.empty': 'Nenhuma zona configurada.',
    'zones.roleSpawn': 'Spawn',
    'zones.roleIncubation': 'Incubação',
    'zones.roleFruiting': 'Frutificação',
    'zones.roleContaminated': 'Contaminação',
    'zones.errIdStart': 'Nome da zona deve começar com uma letra (A-Z)',
    'zones.errLong': 'Nome da zona muito longo (máx. 50 caracteres)',
    'zones.errRackEmpty': 'Nome do rack não pode estar vazio',
    'zones.errTooManyRacks': 'Muitos racks (máx. 50)',
    'zones.hasBags': '{count} bags — remova primeiro',
    'zones.directBags': '{count} sem rack',
    'zones.directBagsHint': 'Esses bags foram escaneados para a zona, não para um rack específico. Mova-os para um rack para rastreamento preciso.',
    'zones.dragToReorder': 'Arraste para reordenar',
    'zones.edit': 'Editar',
    'zones.editTitle': 'Editar zona',
    'zones.moveToRack': 'Mover para rack',
    'zones.moveToRackTitle': 'Mover {count} bags para um rack',
    'zones.movedToRack': '{count} bags movidos para {rack}',
    'zones.addRack': '+ Rack',
    'zones.rackDeleteTitle': 'Excluir rack?',
    'zones.rackDeleteMsg': 'Rack "{name}" será removido.',
    'zones.showQr': 'Mostrar QR',
    'zones.hideQr': 'Ocultar QR',
    'zones.printQr': 'Imprimir QR',
    'zones.printAllQr': 'Imprimir todos QR codes',
    'zones.capacity': 'Capacidade máx. (bags)',
    'zones.errCapacity': 'Capacidade deve ser um número positivo',
    'scanFb.preferRack': '⚠ "{loc}" é uma zona — escaneie um rack para rastreamento preciso (ex. {example})',
    // Calendar entry modal
    'calEntry.titleNew': 'Nova entrada',
    'calEntry.titleEdit': 'Editar entrada',
    'calEntry.name': 'Título',
    'calEntry.namePhTask': 'ex. Limpar tenda de umidade',
    'calEntry.namePhEvent': 'ex. Reunião da equipe',
    'calEntry.category': 'Categoria',
    'calEntry.cat.task': 'Tarefa',
    'calEntry.cat.custom': 'Evento personalizado',
    'calEntry.cat.meeting': 'Reunião',
    'calEntry.cat.delivery': 'Entrega',
    'calEntry.cat.maintenance': 'Manutenção',
    'calEntry.prio': 'Prioridade',
    'calEntry.prio.low': 'Baixa',
    'calEntry.prio.med': 'Média',
    'calEntry.prio.high': 'Alta',
    'calEntry.date': 'Data',
    'calEntry.endDate': 'Até (opcional)',
    'calEntry.allDay': 'Dia inteiro',
    'calEntry.from': 'De',
    'calEntry.to': 'Até',
    'calEntry.recurrence': 'Repetição',
    'calEntry.rec.none': 'Nenhuma',
    'calEntry.rec.daily': 'Diária',
    'calEntry.rec.weekly': 'Semanal',
    'calEntry.rec.monthly': 'Mensal',
    'calEntry.recurrenceUntil': 'Repetir até (opcional)',
    'calEntry.desc': 'Descrição (opcional)',
    'calEntry.descPh': 'Detalhes...',
    'calEntry.assignTo': 'Atribuir a',
    'calEntry.assignTo.all': 'Todos (empresa)',
    'calEntry.assignedTo': 'Atribuído a',
    'calEntry.allClickToSelect': 'Todos (clique para selecionar)',
    'calEntry.noMembers': 'Sem membros da equipe. Adicione na aba Equipe primeiro.',
    'calEntry.private': 'Visível apenas para a pessoa atribuída',
    'calEntry.cancel': 'Cancelar',
    'calEntry.save': 'Salvar',
    'calEntry.delete': 'Excluir',
    'calEntry.deleteTask': 'Excluir tarefa?',
    'calEntry.deleteEvent': 'Excluir evento?',
    'calEntry.deleteTaskMsg': 'Esta tarefa será permanentemente removida.',
    'calEntry.deleteEventMsg': 'Este evento será permanentemente removido.',
    // Calendar views
    'cal.allDay': 'Dia inteiro',
    'cal.allDayShort': 'Dia int.',
    'cal.noAllDay': 'Sem eventos de dia inteiro',
    'cal.more': 'mais',
    'cal.title': 'Calendário',
    'cal.monthView': 'Vista mensal',
    'cal.weekView': 'Vista semanal',
    'cal.dayView': 'Vista diária',
    'cal.printed': 'impresso em',
    'cal.legend.batches': 'Vencimentos',
    'cal.legend.tasks': 'Tarefas',
    'cal.legend.harvests': 'Colheitas',
    'cal.legend.custom': 'Eventos personalizados',
    'cal.legend.meetings': 'Reuniões',
    'cal.legend.deliveries': 'Entregas',
    'cal.legend.maintenance': 'Manutenção',
    'cal.legend.external': 'Eventos externos',
    'cal.days': 'Seg,Ter,Qua,Qui,Sex,Sáb,Dom',
    'cal.months': 'Janeiro,Fevereiro,Março,Abril,Maio,Junho,Julho,Agosto,Setembro,Outubro,Novembro,Dezembro',
    'calEntry.moveTitle': 'Mover entrada',
    'calDetail.close': 'Fechar',
    'calDetail.edit': 'Editar',
    'calDetail.assignedTo': 'Atribuído',
    'calDetail.everyone': 'Todos',
    'calDetail.taskDue': 'Tarefa',
    'calDetail.dueLabel': 'Vencimento',
    'calDetail.markDone': 'Marcar como concluída',
    'calDetail.markUndone': 'Marcar como não concluída',
    'calDetail.batchDue': 'Vencimento do lote',
    'calDetail.harvest': 'Colheita',
    'calDetail.external': 'Evento externo',
    'calEntry.until': 'até',
    'cal.monthShort': 'Mês',
    'cal.weekShort': 'Semana',
    'cal.dayShort': 'Dia',
    'cal.printTitle': 'Imprimir calendário',
    'cal.newEntry': '+ Novo',
    'cal.taskListTitle': 'Lista de tarefas',
    'cal.entries': 'entradas',
    'cal.noTasks': 'sem tarefas',
    'cal.printChooseRange': 'Escolha o período para a lista de tarefas:',
    'cal.printWeek': 'Semana — lista de tarefas da semana atual',
    'cal.printMonth': 'Mês — lista de tarefas do mês atual',
  }
};

// ─── CONSTANTS ───────────────────────────────────────────────
const ACTIONS=['ADD','MOVE','MOVE_BATCH','REMOVE','HARVEST'];
let ZONES=[],ALL_RACKS=[],LOCS=[],RACK_ZONE={};
const toZone=loc=>{if(!loc)return loc;if(RACK_ZONE[loc])return RACK_ZONE[loc];if(ZONES.includes(loc))return loc;const z=ZONES.find(z=>loc.startsWith(z+'_'));return z||loc;};
// ABBR removed — kuerzel comes from mushroomStrains (Pilzsorten) now.
const SP_COLORS=['#e11d48','#0284c7','#059669','#d97706','#7c3aed','#0d9488','#ea580c','#db2777','#0891b2','#65a30d'];
let REF_GROUPS=[];
const KNOWN_ZONE_I18N={SPAWN:'dash.zoneSpawn',INC:'dash.zoneInc',TENT1:'dash.zoneTent1',TENT2:'dash.zoneTent2',TENT3:'dash.zoneTent3',CONTAM:'dash.zoneContam'};
function zoneDisplayName(id){
  if(!id)return id;
  if(KNOWN_ZONE_I18N[id])return t(KNOWN_ZONE_I18N[id]);
  const z=zones.find(x=>x.id===id);
  if(z)return z.name;
  // Try as rack ID: find parent zone and return "ZoneName / rackSuffix"
  for(const zone of zones){
    const rack=zone.racks.find(r=>r.id===id);
    if(rack)return(zone.name||zone.id)+'/'+(id.slice(zone.id.length+1)||id);
  }
  return id;
}
function zoneByRole(role){return zones.filter(z=>z.role===role)}
function rebuildZoneConstants(){
  ZONES=zones.map(z=>z.id);
  ALL_RACKS=zones.flatMap(z=>z.racks.map(r=>r.id));
  LOCS=[...ZONES,...ALL_RACKS];
  RACK_ZONE={};
  zones.forEach(z=>z.racks.forEach(r=>{RACK_ZONE[r.id]=z.id}));
  ZONE_LABELS={};ZONE_COLORS={};
  zones.forEach(z=>{ZONE_LABELS[z.id]=KNOWN_ZONE_I18N[z.id]||z.name;ZONE_COLORS[z.id]=z.color});
  locColor={...ZONE_COLORS};
  // Actions + Quantities stay as text barcodes; Zones + Racks use numeric barcodes
  REF_GROUPS=[{g:'Actions',items:['ADD','MOVE','MOVE_BATCH','REMOVE','HARVEST'].map(a=>({val:a,label:a}))}];
  REF_GROUPS.push({g:'Zones',items:ZONES.map(z=>{const bc=barcodeByEntity.get('zone:'+z);return{val:bc?String(bc):z,label:z}})});
  zones.filter(z=>z.racks.length>0).forEach(z=>{
    const rIds=z.racks.map(r=>r.id);
    for(let i=0;i<rIds.length;i+=5){const chunk=rIds.slice(i,i+5);const label=z.name+' Racks '+(i+1)+'–'+(i+chunk.length);REF_GROUPS.push({g:label,items:chunk.map(r=>{const bc=barcodeByEntity.get('rack:'+r);return{val:bc?String(bc):r,label:r}})})}
  });
}

// ─── DATA ────────────────────────────────────────────────────
let mushroomStrains=[],batches=[],scanLog=[],movements=[],manualTasks=[],harvests=[],cultures=[],inventory={},teamMembers=[],caldav={},duckdns={},assets=[],zones=[],suppliers=[];
// Numeric barcode registry: Map<number, {type, id}> and reverse Map<string, number>
let barcodeRegistry=new Map(),barcodeByEntity=new Map();
let appUsers=[];let calEvSelectedAssignees=[];let calTaskSelectedAssignees=[];
let scan={action:null,from:null,to:null,count:0,harvestBag:null};
let confirmCb=null,noteId=null,saving=false,lastHash='';
let spMap={};
const spColor=s=>{const k=(s||'').toLowerCase();if(!spMap[k])spMap[k]=SP_COLORS[Object.keys(spMap).length%SP_COLORS.length];return spMap[k]};
const spDot=s=>`<span class="sp-dot" style="background:${spColor(s)}"></span>`;

// ─── HTML ESCAPING ──────────────────────────────────────────
function esc(s){
  if(s==null)return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function safeColor(c,fallback){
  if(!c)return fallback||'#16a34a';
  return /^#[0-9a-fA-F]{3,8}$/.test(c)?c:(fallback||'#16a34a');
}

// ─── AUTH ────────────────────────────────────────────────────
let currentUser=null;
async function authFetch(url,opts){
  const r=await fetch(url,opts);
  if(r.status===401){window.location.href='/login.html';throw new Error('unauthorized');}
  return r;
}
function _apiCall(method,path,body){
  _mutating++;
  setSyncStatus('busy','Saving...');
  const opts={method,headers:{}};
  if(body){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(body)}
  return authFetch(path,opts).then(r=>{
    return r.json().catch(()=>({})).then(d=>{
      _mutating--;
      if(!r.ok){
        const msg=d.error||('HTTP '+r.status);
        setSyncStatus('err',msg);
        return d.error?d:{error:msg};
      }
      if(_mutating===0)setSyncStatus('ok','Saved · gerade eben');
      return d;
    });
  }).catch(e=>{
    _mutating--;
    setSyncStatus('err','Save error: '+(e.message||'check server'));
    console.error('API error:',method,path,e);
    return {error:e.message||'Network error'};
  });
}
function apiPost(path,body){return _apiCall('POST',path,body)}
function apiPatch(path,body){return _apiCall('PATCH',path,body)}
function apiDelete(path){return _apiCall('DELETE',path)}
async function invDelta(mat,deltaKg,type,ref){return apiPost('/api/inventory/delta',{mat,deltaKg,type,ref})}
async function invDeltas(deltas){for(const d of deltas)await invDelta(d.mat,d.deltaKg,d.type,d.ref)}
async function invSetAbsolute(mat,value,type,ref){return apiPost('/api/inventory/set',{mat,value,type,ref})}
async function saveInvConfig(){return apiPost('/api/inventory/config',{thresholds:inventory.thresholds,avgComposition:inventory.avgComposition})}
async function loadCurrentUser(){
  try{const r=await authFetch('/api/auth/me');currentUser=await r.json();}catch(e){if(e.message!=='unauthorized')console.error('Auth check failed:',e)}
  showServerTab();showMcpTab();
}

// ─── SYNC ────────────────────────────────────────────────────
async function loadData(){
  setSyncStatus('busy','Syncing...');
  try{
    const d=await authFetch('/api/data').then(r=>r.json());
    lastHash=JSON.stringify(d);
    applyData(d);
    setSyncStatus('ok','Synced · gerade eben');
    refresh();
  }catch(e){if(e.message!=='unauthorized')setSyncStatus('err','Sync error')}
}
function applyData(d){
  mushroomStrains=d.mushroomStrains||[];
  batches=d.batches||[];scanLog=d.scanLog||[];movements=d.movements||d.scanLog||[];manualTasks=d.manualTasks||[];
  harvests=d.harvests||[];cultures=d.cultures||[];
  inventory=d.inventory||defaultInventory();
  teamMembers=d.teamMembers||[];caldav=d.caldav||{};duckdns=d.duckdns||{};assets=d.assets||[];
  calendarEvents=d.calendarEvents||[];zones=d.zones||[];suppliers=d.suppliers||[];
  // Build barcode registry from server data
  barcodeRegistry=new Map();barcodeByEntity=new Map();
  for(const bc of d.barcodes||[]){
    barcodeRegistry.set(bc.barcode,{type:bc.entity_type,id:bc.entity_id});
    barcodeByEntity.set(bc.entity_type+':'+bc.entity_id,bc.barcode);
  }
  rebuildZoneConstants();
  batches.forEach(b=>spColor(b.species));cultures.forEach(c=>spColor(c.species));
  fillStrainSelects();
  fillCultureSelect('nb-culture',['PD','LC']);fillCultureSelect('gs-culture',['PD','LC']);updateTodoBadge();
  if(typeof fillCalendarUserFilter==='function')fillCalendarUserFilter();
}
function defaultInventory(){
  return{
    stock:{hardwood:0,wheatbran:0,gypsum:0,grain:0},
    thresholds:{hardwood:{minKg:50},wheatbran:{minKg:20},gypsum:{minKg:5},grain:{minKg:10}},
    // Average substrate composition used for "~X bags" estimates
    // These are editable in the Inventory → Stock tab
    avgComposition:{hwPct:75,wbPct:25,rhPct:63,bagKg:3,grainBagKg:1},
    log:[]
  };
}
// saveData() removed — all mutations now use atomic REST endpoints (apiPost/apiPatch/apiDelete)
let _mutating=0; // tracks in-flight mutations to block pollSync from overwriting
let lastSyncTime=null;
function formatRelativeTime(ts){
  const sec=Math.round((Date.now()-ts)/1000);
  if(sec<5)return 'gerade eben';
  if(sec<60)return 'vor '+sec+'s';
  const min=Math.floor(sec/60);
  if(min<60)return 'vor '+min+' Min.';
  return 'vor '+Math.floor(min/60)+' Std.';
}
function setSyncStatus(cls,msg){document.getElementById('sync-dot').className='sync-dot '+cls;document.getElementById('sync-label').textContent=msg;const m=document.getElementById('sync-dot-m');if(m)m.className='sync-dot '+cls;if(cls==='ok')lastSyncTime=Date.now()}
// Update relative time display every 5 seconds
setInterval(()=>{
  if(!lastSyncTime)return;
  const dot=document.getElementById('sync-dot');
  if(!dot||!dot.classList.contains('ok'))return;
  document.getElementById('sync-label').textContent='Synced · '+formatRelativeTime(lastSyncTime);
},5000);
let _polling=false;
async function pollSync(){
  if(_mutating>0||_polling)return;
  _polling=true;
  try{const d=await authFetch('/api/data').then(r=>r.json());const h=JSON.stringify(d);if(h!==lastHash){lastHash=h;applyData(d);setSyncStatus('ok','Synced · gerade eben');refresh();}else{lastSyncTime=lastSyncTime||Date.now()}}catch(e){if(e.message!=='unauthorized')setSyncStatus('err','Sync error')}
  finally{_polling=false}
}

// ── SSE real-time sync (replaces 5s polling for connected clients) ──
let _sse=null;
let _sseReconnectTimer=null;
let _sseRetryDelay=1000;
function connectSSE(){
  if(_sse)return;
  try{
    _sse=new EventSource('/api/events');
    _sse.onopen=function(){
      _sseRetryDelay=1000; // Reset backoff on successful connection
      setSyncStatus('ok','Connected');
    };
    _sse.onmessage=function(ev){
      try{
        const msg=JSON.parse(ev.data);
        if(msg.type==='data-changed'&&_mutating===0)pollSync();
        if(msg.type==='connected')setSyncStatus('ok','Connected');
      }catch(e){/* ignore parse errors */}
    };
    _sse.onerror=function(){
      _sse.close();_sse=null;
      setSyncStatus('err','Connection lost');
      // Exponential backoff reconnect, capped at 30s
      if(!_sseReconnectTimer){
        _sseReconnectTimer=setTimeout(()=>{_sseReconnectTimer=null;connectSSE()},Math.min(_sseRetryDelay,30000));
        _sseRetryDelay=Math.min(_sseRetryDelay*2,30000);
      }
    };
  }catch(e){/* SSE not supported — polling fallback active */}
}
function disconnectSSE(){if(_sse){_sse.close();_sse=null}if(_sseReconnectTimer){clearTimeout(_sseReconnectTimer);_sseReconnectTimer=null}_sseRetryDelay=1000}

// ─── SIDEBAR ────────────────────────────────────────────────
function toggleSidebar(){
  const sb=document.getElementById('sidebar');
  const ov=document.getElementById('sb-overlay');
  const isMobile=window.innerWidth<=768;
  if(isMobile){
    sb.classList.toggle('sb-open');
    ov.classList.toggle('sb-show');
    document.body.classList.toggle('sb-mobile-open');
  }else{
    sb.classList.toggle('sb-collapsed');
    document.body.classList.toggle('sb-is-collapsed');
  }
}
// Close sidebar on mobile when navigating
function sbCloseMobile(){
  if(window.innerWidth<=768){
    document.getElementById('sidebar').classList.remove('sb-open');
    document.getElementById('sb-overlay').classList.remove('sb-show');
    document.body.classList.remove('sb-mobile-open');
  }
}

// ─── NAV ─────────────────────────────────────────────────────
const PAGES={dash:'n-dash',batch:'n-batch',lab:'n-lab',assets:'n-assets',print:'n-print',cal:'n-cal',settings:'n-settings',strains:'n-strains'};
function go(page,btnId){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.sb-nav .sb-btn, .sb-footer .sb-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('p-'+page).classList.add('active');
  document.getElementById(btnId).classList.add('active');
  if(page==='dash'){renderStatus();renderDashAlerts();renderDashBatchTasks();}
  if(page==='batch')renderBatches();
  if(page==='lab')renderCultures();
  if(page==='inv'){renderInvStock();}
  if(page==='zones')renderZones();
  if(page==='assets')renderAssets();
  if(page==='print'){fillBatchSelect();renderLabList();}
  if(page==='cal'){renderCalendar();loadCalDAVImports().then(()=>renderCalendar());}
  if(page==='settings')renderLog();
  if(page==='strains')renderStrains();
  updateTodoBadge();
  sbCloseMobile();
}
function openStab(page,sub){
  document.querySelectorAll(`#p-${page} .stab`).forEach(b=>b.classList.remove('active'));
  document.querySelectorAll(`#p-${page} .sp`).forEach(p=>p.classList.remove('active'));
  const stEl=document.getElementById(`st-${page}-${sub}`);if(stEl)stEl.classList.add('active');
  const spEl=document.getElementById(`sp-${page}-${sub}`);if(spEl)spEl.classList.add('active');
  if(page==='batch'&&sub==='list')renderBatches();
  if(page==='batch'&&sub==='harvest')renderHarvests();
  if(page==='lab'&&sub==='cultures')renderCultures();
  if(page==='lab'&&sub==='work'){lwUpdate();renderLabLog();}
  if(page==='lab'&&sub==='lineage')fillLineageSelect();
  if(page==='inv'&&sub==='stock')renderInvStock();
  if(page==='inv'&&sub==='delivery'){delMatChange();adjMatChange();}
  if(page==='inv'&&sub==='log')renderInvLog();
  if(page==='assets'&&sub==='list')renderAssets();
  if(page==='assets'&&sub==='add')resetAssetForm();
  if(page==='assets'&&sub==='export')initExportTab();
  if(page==='assets'&&sub==='labels')renderAssetLabelList();
  if(page==='print'&&sub==='bags')fillBatchSelect();
  if(page==='print'&&sub==='lab'){renderLabList();renderLabPreview();}
  if(page==='print'&&sub==='ref')renderRefBarcodes();
  if(page==='cal'&&sub==='cal'){loadCalDAVImports().then(()=>renderCalendar());}
  if(page==='settings'&&sub==='caldav')loadCaldavSettings();
  if(page==='settings'&&sub==='duckdns')loadDuckdnsSettings();
  if(page==='settings'&&sub==='mcp')loadMcpSettings();
  if(page==='settings'&&sub==='log')renderLog();
}
function refresh(){
  const active=document.querySelector('.page.active');if(!active)return;
  const id=active.id.replace('p-','');
  if(id==='dash'){renderStatus();renderDashAlerts();renderDashBatchTasks();}
  if(id==='batch')renderBatches();
  if(id==='lab')renderCultures();
  if(id==='inv')renderInvStock();
  if(id==='assets')renderAssets();
  if(id==='zones')renderZones();
  if(id==='cal')renderCalendar();
  if(id==='strains')renderStrains();
  updateTodoBadge();
}

// ─── MODALS ──────────────────────────────────────────────────
function confirm2(title,body,label,cb){document.getElementById('m-title').textContent=title;document.getElementById('m-body').textContent=body;document.getElementById('m-ok').textContent=label||'Confirm';confirmCb=cb;document.getElementById('m-confirm').classList.add('open')}
function closeConfirm(){document.getElementById('m-confirm').classList.remove('open');confirmCb=null}
document.getElementById('m-ok').onclick=()=>{if(confirmCb)confirmCb();closeConfirm()};
document.getElementById('m-confirm').addEventListener('click',e=>{if(e.target.id==='m-confirm')closeConfirm()});
let promptCb=null;
function prompt2(title,placeholder,cb){document.getElementById('m-pr-title').textContent=title;const inp=document.getElementById('m-pr-input');inp.value='';inp.placeholder=placeholder||'';promptCb=cb;document.getElementById('m-prompt').classList.add('open');setTimeout(()=>inp.focus(),80)}
function closePrompt(){document.getElementById('m-prompt').classList.remove('open');promptCb=null}
document.getElementById('m-pr-ok').onclick=()=>{if(promptCb)promptCb(document.getElementById('m-pr-input').value.trim());closePrompt()};
document.getElementById('m-pr-cancel').onclick=closePrompt;
document.getElementById('m-prompt').addEventListener('click',e=>{if(e.target.id==='m-prompt')closePrompt()});
document.getElementById('m-pr-input').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();document.getElementById('m-pr-ok').click()}});
function openNote(id){const b=batches.find(x=>x.batchId===id);if(!b)return;noteId=id;document.getElementById('m-note-title').textContent='Note — '+id;document.getElementById('m-note-text').value=b.notes||'';document.getElementById('m-note').classList.add('open');setTimeout(()=>document.getElementById('m-note-text').focus(),80)}
function closeNote(){document.getElementById('m-note').classList.remove('open');noteId=null}
function saveNote(){const b=batches.find(x=>x.batchId===noteId);if(b){b.notes=document.getElementById('m-note-text').value.trim();apiPatch('/api/batches/'+encodeURIComponent(noteId),{notes:b.notes});renderBatches()}closeNote()}
document.getElementById('m-note').addEventListener('click',e=>{if(e.target.id==='m-note')closeNote()});

// Batch-add modal
function openBatchAdd(){
  const bs=document.getElementById('ba-batch');
  bs.innerHTML='<option value="">— choose batch —</option>'+batches.map(b=>`<option value="${esc(b.batchId)}">${esc(b.batchId)} (${esc(b.species)})</option>`).join('');
  const ls=document.getElementById('ba-loc');
  ls.innerHTML=[...ZONES,...ALL_RACKS].map(l=>`<option value="${l}">${l}</option>`).join('');
  bs.onchange=baPreview;ls.onchange=baPreview;
  document.getElementById('m-batchadd').classList.add('open');
}
function closeBatchAdd(){document.getElementById('m-batchadd').classList.remove('open')}
function baPreview(){const id=document.getElementById('ba-batch').value,loc=document.getElementById('ba-loc').value,b=batches.find(x=>x.batchId===id);document.getElementById('ba-prev').textContent=b?`Will log ${b.bags.length} bags → ${loc}`:'';}
document.getElementById('m-batchadd').addEventListener('click',e=>{if(e.target.id==='m-batchadd')closeBatchAdd()});
function confirmBatchAdd(){
  const id=document.getElementById('ba-batch').value,loc=document.getElementById('ba-loc').value,batch=batches.find(x=>x.batchId===id);
  if(!id||!batch){alert('Select a batch first');return}
  if(!loc){alert('Select a location first');return}
  const now=new Date().toISOString();
  const entries=[];
  batch.bags.forEach(bagId=>{
    const tempId='s'+(++_scanTempIdCounter);
    const entry={time:now,action:'ADD',batch:id,bag:bagId,from:null,to:loc,species:batch.species,strain:batch.strain,user:currentUser?.username||null,_tempId:tempId};
    scanLog.push(entry);movements.push(entry);
    if(!sessionStartTime)sessionStartTime=Date.now();
    sessionEntries.push(entry);
    scan.count++;
    entries.push(entry);
  });
  apiPost('/api/scan-log',{entries}).then(function(r){
    if(r&&r.ids)entries.forEach((e,i)=>{if(r.ids[i])e._serverId=r.ids[i]});
  });
  updateSD();setFb('ok',`Batch ADD: ${batch.bags.length} bags → ${loc}`);closeBatchAdd();
}

// ─── HELPERS ─────────────────────────────────────────────────
const abbrev=s=>{if(!s)return'BAGX';const ms=mushroomStrains.find(x=>x.name.toLowerCase()===s.toLowerCase());if(ms&&ms.kuerzel)return ms.kuerzel;return s.replace(/\s+/g,'').slice(0,4).toUpperCase().padEnd(4,'X')};
const todayStr=()=>{const d=new Date();return String(d.getDate()).padStart(2,'0')+String(d.getMonth()+1).padStart(2,'0')+String(d.getFullYear()).slice(2)};
const genBatchId=sp=>{const ab=abbrev(sp),dt=todayStr(),n=batches.filter(b=>b.batchId.startsWith(ab+'-'+dt)).length;return ab+'-'+dt+'-'+String(n+1).padStart(2,'0')};
const sbadge=s=>{const m={INCUBATING:'b-inc',FRUITING:'b-tent','SPAWN RUN':'b-spawn',CONTAM:'b-contam',DONE:'b-done',EMPTY:'b-done'};return`<span class="badge ${m[s]||'b-done'}">${s}</span>`};

// ─── STATUS CALC ─────────────────────────────────────────────
function getStatus(id){
  const c={};ZONES.forEach(z=>c[z]=0);
  scanLog.filter(e=>e.batch===id).forEach(e=>{
    const tz=toZone(e.to),fz=toZone(e.from);
    if(e.action==='ADD'&&e.to&&c[tz]!==undefined)c[tz]=Math.max(0,c[tz]+1);
    if(e.action==='MOVE'||e.action==='MOVE_BATCH'){if(e.from&&c[fz]!==undefined)c[fz]=Math.max(0,c[fz]-1);if(e.to&&c[tz]!==undefined)c[tz]++}
    if(e.action==='REMOVE'&&e.from&&c[fz]!==undefined)c[fz]=Math.max(0,c[fz]-1);
  });
  const total=Object.values(c).reduce((a,b)=>a+b,0);
  // Aggregate by role
  const byRole={};zones.forEach(z=>{if(!byRole[z.role])byRole[z.role]=0;byRole[z.role]+=c[z.id]||0});
  let status='EMPTY',action='';
  if(byRole.fruiting>0){status='FRUITING';action=t('status.action.harvest')}
  else if(byRole.incubation>0){status='INCUBATING';action=t('status.action.moveTent')}
  else if(byRole.spawn>0){status='SPAWN RUN';action=t('status.action.monitorSpawn')}
  else if(byRole.contaminated>0){status='CONTAM';action=t('status.action.discard')}
  else if(total===0&&scanLog.some(e=>e.batch===id)){status='DONE'}
  return{c,total,status,action};
}
const getHarvested=id=>harvests.filter(h=>h.batch===id).reduce((s,h)=>s+(h.grams||0),0);

// ─── DASHBOARD ───────────────────────────────────────────────
let harvestChartInst=null,batchYieldInst=null,timelineInst=null;

function renderMetrics(tot,inc,tent,contam){
  const totalHarv=harvests.reduce((s,h)=>s+(h.grams||0),0);
  const contamRate=tot>0?Math.round((contam/tot)*100):0;
  const icons=[
    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>`,
    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`
  ];
  const colors=['#16a34a','#2563eb','#16a34a','#d97706'];
  document.getElementById('metrics').innerHTML=[
    [t('dash.totalBatches'),tot,0],
    [t('dash.inIncubation'),inc,1],
    [t('dash.inTents'),tent,2],
    [t('dash.totalHarvested'),totalHarv>0?(totalHarv>=1000?(totalHarv/1000).toFixed(1)+'kg':totalHarv+'g'):'—',3]
  ].map(([l,v,i])=>`<div class="met" style="border-left-color:${colors[i]}"><div class="met-l"><span style="display:inline-flex;vertical-align:middle;margin-right:6px">${icons[i]}</span>${l}</div><div class="met-v" style="color:${colors[i]}">${v}</div></div>`).join('');
}

function renderPipelineChart(){
  const roleStages=[
    {role:'spawn',label:'SPAWN',color:'#a855f7'},
    {role:'incubation',label:'INC',color:'#0ea5e9'},
    {role:'fruiting',label:'TENT',color:'#10b981'},
    {role:null,label:'DONE',color:'#e5e3dd'},
    {role:'contaminated',label:'CONTAM',color:'#ef4444'}
  ];
  // Use first zone's color for each role if available
  const stages=roleStages.map(s=>{
    if(s.role){const z=zones.find(x=>x.role===s.role);if(z)return{...s,color:z.color}}
    return s;
  });
  const counts={};stages.forEach(s=>counts[s.label]=0);
  batches.forEach(b=>{
    const{c,status}=getStatus(b.batchId);
    zones.forEach(z=>{
      const stg=stages.find(s=>s.role===z.role);
      if(stg)counts[stg.label]+=(c[z.id]||0);
    });
    if(status==='DONE')counts.DONE++;
  });
  const max=Math.max(1,...Object.values(counts));
  const el=document.getElementById('pipeline-chart');
  el.innerHTML=stages.map(s=>{
    const v=counts[s.label]||0;
    const pct=Math.round((v/max)*100);
    return`<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <div style="width:52px;font-size:12px;font-weight:600;color:var(--c-text-sec);text-align:right;flex-shrink:0">${s.label}</div>
      <div style="flex:1;height:26px;background:var(--c-border-light);border-radius:6px;overflow:hidden">
        <div style="height:100%;background:${s.color};width:${pct}%;border-radius:6px;transition:width .4s ease;display:flex;align-items:center;padding-left:10px">
          ${v>0?`<span style="font-size:12px;font-weight:700;color:rgba(255,255,255,.95)">${v}</span>`:''}
        </div>
      </div>
      <div style="width:32px;font-size:12px;color:var(--c-text-sec);text-align:right;flex-shrink:0;font-weight:600">${v}</div>
    </div>`;
  }).join('');
}

function renderHarvestChart(){
  const canvas=document.getElementById('harvest-chart');
  if(!canvas)return;
  // Group by species
  const bySpecies={};
  harvests.forEach(h=>{if(!bySpecies[h.species])bySpecies[h.species]=0;bySpecies[h.species]+=h.grams||0});
  const labels=Object.keys(bySpecies);
  const data=labels.map(s=>bySpecies[s]/1000);
  const colors=labels.map(s=>spColor(s));
  if(harvestChartInst){harvestChartInst.destroy();harvestChartInst=null}
  if(!labels.length){canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);const ctx=canvas.getContext('2d');ctx.fillStyle='#aaa';ctx.font='12px system-ui';ctx.textAlign='center';ctx.fillText(t('harvest.noData'),canvas.width/2,80);return}
  const fmtKg=v=>(Math.round(v*100)/100)+'kg';
  harvestChartInst=new Chart(canvas,{
    type:'bar',
    data:{labels,datasets:[{data,backgroundColor:colors,borderRadius:5,borderSkipped:false}]},
    options:{responsive:true,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>fmtKg(ctx.parsed.y)}}},scales:{y:{ticks:{callback:v=>fmtKg(v),color:'#64748b'},grid:{color:'#f1f5f9'}},x:{grid:{display:false},ticks:{color:'#64748b'}}}}
  });
}

let ZONE_LABELS={};
let ZONE_COLORS={};
function rackLabel(id){const m=id.match(/\d+$/);return m?t('dash.rackN',{n:m[0]}):id.replace(/_/g,' ')}

function renderStatus(){
  const q=(document.getElementById('status-q')?.value||'').toLowerCase();
  const el=document.getElementById('dash-locations');
  if(!el)return;
  if(!zones.length){el.innerHTML='<div class="empty">'+t('dash.noZones')+'</div>';renderMetrics(0,0,0,0);renderPipelineChart();renderHarvestChart();return}
  if(!batches.length){el.innerHTML='<div class="empty">'+t('dash.noBatches')+'</div>';renderMetrics(0,0,0,0);renderPipelineChart();renderHarvestChart();return}

  // Compute per-batch status
  let ti=0,tt=0,tc=0;
  const batchData=batches.map(b=>{
    const{c,total,status}=getStatus(b.batchId);
    zones.forEach(z=>{
      if(z.role==='spawn'||z.role==='incubation')ti+=c[z.id]||0;
      if(z.role==='fruiting')tt+=c[z.id]||0;
      if(z.role==='contaminated')tc+=c[z.id]||0;
    });
    const harv=getHarvested(b.batchId);
    const due=new Date(b.due);
    const ov=due<new Date()&&zones.some(z=>(z.role==='incubation'||z.role==='spawn')&&(c[z.id]||0)>0);
    return{b,c,total,status,harv,due,ov};
  });

  // Filter by search
  const filtered=batchData.filter(d=>!q||d.b.batchId.toLowerCase().includes(q)||(d.b.species||'').toLowerCase().includes(q)||(d.b.strain||'').toLowerCase().includes(q)||(d.b.strainName||'').toLowerCase().includes(q));

  let html='';
  // Render zones dynamically by role
  const fruitingZones=zones.filter(z=>z.role==='fruiting');
  const contamZones=zones.filter(z=>z.role==='contaminated');
  zones.filter(z=>z.role!=='fruiting'&&z.role!=='contaminated').forEach(z=>{
    if(z.racks.length>0)html+=renderRackSection(z.id,z.racks.map(r=>r.id),filtered);
    else html+=renderSimpleZoneSection(z,filtered);
  });
  if(fruitingZones.length)html+=renderFruitingSection(fruitingZones,filtered);
  contamZones.forEach(z=>{
    const contamBags=getZoneBags(z.id);
    if(Object.keys(contamBags).length>0)html+=renderContamSection(z,filtered);
  });

  el.innerHTML=html;
  renderMetrics(batches.length,ti,tt,tc);
  renderPipelineChart();
  renderHarvestChart();
  updateActionBar();
}

function renderRackSection(zone,racks,filtered){
  const color=ZONE_COLORS[zone];
  const zoneObj=zones.find(z=>z.id===zone);
  const cap=zoneObj?zoneObj.maxCapacity:null;
  let totalBags=0;
  racks.forEach(r=>totalBags+=Object.keys(getRackBags(r)).length);
  const q=(document.getElementById('status-q')?.value||'').toLowerCase();

  let rackCards=racks.map(rackId=>{
    const bags=getRackBags(rackId);
    const count=Object.keys(bags).length;
    const byBatch={};
    Object.entries(bags).forEach(([bagId,d])=>{
      if(!byBatch[d.batchId])byBatch[d.batchId]={sp:d.species,st:d.strain,bags:[]};
      byBatch[d.batchId].bags.push({id:bagId,loc:rackId});
    });
    // Filter batches by search
    const batchEntries=Object.entries(byBatch).filter(([bid,d])=>!q||bid.toLowerCase().includes(q)||d.sp.toLowerCase().includes(q)||d.st.toLowerCase().includes(q));

    let batchHtml=batchEntries.map(([bid,d])=>{
      const bd=filtered.find(f=>f.b.batchId===bid);
      const ov=bd?bd.ov:false;
      d.bags.sort((a,b)=>(parseInt(a.id.split('-').pop())||0)-(parseInt(b.id.split('-').pop())||0));
      return`<div class="batch-card${ov?' batch-overdue':''}" style="--sp-color:${spColor(d.sp)}" onclick="this.classList.toggle('expanded')">
        <div class="batch-card-header">
          <span class="batch-card-species">${esc(d.sp)}</span>
          <span class="batch-card-count">${d.bags.length}</span>
        </div>
        <div class="batch-card-meta">
          <span style="font-family:monospace;font-size:10px">${esc(bid)}</span>
          <span>${esc(d.st)}</span>
          ${bd&&bd.ov?`<span class="overdue-text">${t('dash.overdue')}</span>`:''}
        </div>
        <div class="batch-card-chips">${d.bags.map(bg=>{
          const sel=selectedLocBags.has(bg.id);
          return`<span class="bag-chip${sel?' selected':''}" data-bag="${esc(bg.id)}" data-batch="${esc(bid)}" data-loc="${esc(bg.loc)}">${bg.id.split('-').pop()}</span>`;
        }).join('')}</div>
      </div>`;
    }).join('');
    if(!batchEntries.length&&!count)batchHtml=`<div style="font-size:11px;color:var(--c-text-muted);font-style:italic">${t('dash.empty')}</div>`;

    return`<div class="rack-card-new">
      <div class="rack-card-header">
        <span class="rack-card-name">${rackLabel(rackId)}</span>
        <span class="rack-card-count">${tp('dash.bags',count)}</span>
      </div>
      <div class="rack-card-bar"><div class="rack-card-bar-fill" style="background:${color};width:${Math.min(100,Math.round(count/20*100))}%"></div></div>
      <div class="rack-card-batches">${batchHtml}</div>
    </div>`;
  }).join('');

  const rackCount=racks.length;
  const gridClass=rackCount>4?'rack-grid rack-grid-5col':'rack-grid';
  const capHtml=cap?`<div style="display:flex;align-items:center;gap:8px;margin-top:4px">
      <div style="flex:1;height:6px;background:var(--c-bg);border-radius:3px;overflow:hidden"><div style="height:100%;background:${totalBags>cap?'#ef4444':color};width:${Math.min(100,Math.round(totalBags/cap*100))}%;border-radius:3px"></div></div>
      <span style="font-size:11px;color:${totalBags>cap?'#ef4444':'var(--c-text-muted)'};white-space:nowrap">${Math.round(totalBags/cap*100)}%</span>
    </div>`:'';
  return`<div class="location-section">
    <div class="location-section-header">
      <div class="location-section-title"><span class="zone-dot" style="background:${color}"></span>${zoneDisplayName(zone)}</div>
      <span class="location-section-count">${cap?totalBags+' / '+cap+' Bags':tp('dash.bags',totalBags)}</span>
    </div>${capHtml}
    <div class="${gridClass}">${rackCards}</div>
  </div>`;
}

function renderFruitingSection(fruitingZones,filtered){
  let totalBags=0;
  fruitingZones.forEach(z=>totalBags+=Object.keys(getZoneBags(z.id)).length);
  const q=(document.getElementById('status-q')?.value||'').toLowerCase();
  const color=fruitingZones[0]?.color||'#22c55e';

  const tentCols=fruitingZones.map(z=>{
    const bags=getZoneBags(z.id);
    const entries=Object.entries(bags);
    const byBatch={};
    entries.forEach(([bagId,d])=>{
      if(!byBatch[d.batchId])byBatch[d.batchId]={sp:d.species,st:d.strain,bags:[]};
      byBatch[d.batchId].bags.push({id:bagId,loc:d.loc});
    });
    const batchEntries=Object.entries(byBatch).filter(([bid,d])=>!q||bid.toLowerCase().includes(q)||d.sp.toLowerCase().includes(q)||d.st.toLowerCase().includes(q));

    if(!batchEntries.length){
      return`<div class="tent-column">
        <div class="tent-column-header">${zoneDisplayName(z.id)}</div>
        <div class="tent-column-empty">${t('dash.empty')}</div>
      </div>`;
    }
    const cards=batchEntries.map(([bid,d])=>{
      const bd=filtered.find(f=>f.b.batchId===bid);
      const harv=bd?bd.harv:0;
      const due=bd?bd.due:null;
      const ov=bd?bd.ov:false;
      d.bags.sort((a,b)=>(parseInt(a.id.split('-').pop())||0)-(parseInt(b.id.split('-').pop())||0));
      return`<div class="batch-card${ov?' batch-overdue':''}" style="--sp-color:${spColor(d.sp)}" onclick="this.classList.toggle('expanded')">
        <div class="batch-card-header">
          <span class="batch-card-species">${esc(d.sp)}</span>
          <span class="batch-card-count">${d.bags.length}</span>
        </div>
        <div class="batch-card-meta">
          <span style="font-family:monospace;font-size:10px">${esc(bid)}</span>
          <span>${esc(d.st)}</span>
          ${harv>0?`<span style="color:var(--c-amber-dark);font-weight:500">${t('dash.harvested')}: ${harv}g</span>`:''}
          ${due?`<span style="color:${ov?'var(--c-red-dark)':'var(--c-text-muted)'}">${t('dash.due')}: ${fmtDt(due)}${ov?' \u26a0':''}</span>`:''}
        </div>
        <div class="batch-card-chips">${d.bags.map(bg=>{
          const sel=selectedLocBags.has(bg.id);
          return`<span class="bag-chip${sel?' selected':''}" data-bag="${esc(bg.id)}" data-batch="${esc(bid)}" data-loc="${esc(bg.loc)}">${bg.id.split('-').pop()}</span>`;
        }).join('')}</div>
      </div>`;
    }).join('');
    const cap=z.maxCapacity;
    const capBar=cap?`<div style="display:flex;align-items:center;gap:6px;margin:4px 0">
        <div style="flex:1;height:5px;background:var(--c-bg);border-radius:3px;overflow:hidden"><div style="height:100%;background:${entries.length>cap?'#ef4444':z.color||color};width:${Math.min(100,Math.round(entries.length/cap*100))}%;border-radius:3px"></div></div>
        <span style="font-size:10px;color:${entries.length>cap?'#ef4444':'var(--c-text-muted)'}">${Math.round(entries.length/cap*100)}%</span>
      </div>`:'';
    return`<div class="tent-column">
      <div class="tent-column-header">${zoneDisplayName(z.id)} <span style="font-size:11px;font-weight:400;color:var(--c-text-muted)">(${cap?entries.length+'/'+cap:entries.length})</span></div>${capBar}
      ${cards}
    </div>`;
  }).join('');

  return`<div class="location-section">
    <div class="location-section-header">
      <div class="location-section-title"><span class="zone-dot" style="background:${color}"></span>${t('dash.fruitingTents')}</div>
      <span class="location-section-count">${tp('dash.bags',totalBags)}</span>
    </div>
    <div class="tent-columns">${tentCols}</div>
  </div>`;
}

function renderSimpleZoneSection(zone,filtered){
  const bags=getZoneBags(zone.id);
  const entries=Object.entries(bags);
  const q=(document.getElementById('status-q')?.value||'').toLowerCase();
  const byBatch={};
  entries.forEach(([bagId,d])=>{
    if(!byBatch[d.batchId])byBatch[d.batchId]={sp:d.species,st:d.strain,bags:[]};
    byBatch[d.batchId].bags.push({id:bagId,loc:d.loc});
  });
  const batchEntries=Object.entries(byBatch).filter(([bid,d])=>!q||bid.toLowerCase().includes(q)||d.sp.toLowerCase().includes(q)||d.st.toLowerCase().includes(q));
  const cards=batchEntries.map(([bid,d])=>{
    d.bags.sort((a,b)=>(parseInt(a.id.split('-').pop())||0)-(parseInt(b.id.split('-').pop())||0));
    return`<div class="batch-card" style="--sp-color:${spColor(d.sp)}" onclick="this.classList.toggle('expanded')">
      <div class="batch-card-header"><span class="batch-card-species">${esc(d.sp)}</span><span class="batch-card-count">${d.bags.length}</span></div>
      <div class="batch-card-meta"><span style="font-family:monospace;font-size:10px">${esc(bid)}</span><span>${esc(d.st)}</span></div>
      <div class="batch-card-chips">${d.bags.map(bg=>{
        const sel=selectedLocBags.has(bg.id);
        return`<span class="bag-chip${sel?' selected':''}" data-bag="${esc(bg.id)}" data-batch="${esc(bid)}" data-loc="${esc(bg.loc)}">${bg.id.split('-').pop()}</span>`;
      }).join('')}</div>
    </div>`;
  }).join('');
  if(!cards)return'';
  const cap=zone.maxCapacity;
  const capHtml=cap?`<div style="display:flex;align-items:center;gap:8px;margin-top:4px">
      <div style="flex:1;height:6px;background:var(--c-bg);border-radius:3px;overflow:hidden"><div style="height:100%;background:${entries.length>cap?'#ef4444':zone.color};width:${Math.min(100,Math.round(entries.length/cap*100))}%;border-radius:3px"></div></div>
      <span style="font-size:11px;color:${entries.length>cap?'#ef4444':'var(--c-text-muted)'};white-space:nowrap">${Math.round(entries.length/cap*100)}%</span>
    </div>`:'';
  return`<div class="location-section">
    <div class="location-section-header">
      <div class="location-section-title"><span class="zone-dot" style="background:${zone.color}"></span>${zoneDisplayName(zone.id)}</div>
      <span class="location-section-count">${cap?entries.length+' / '+cap+' Bags':tp('dash.bags',entries.length)}</span>
    </div>${capHtml}
    <div style="display:flex;flex-direction:column;gap:6px">${cards}</div>
  </div>`;
}

function renderContamSection(zone,filtered){
  const bags=getZoneBags(zone.id);
  const entries=Object.entries(bags);
  const q=(document.getElementById('status-q')?.value||'').toLowerCase();
  const byBatch={};
  entries.forEach(([bagId,d])=>{
    if(!byBatch[d.batchId])byBatch[d.batchId]={sp:d.species,st:d.strain,bags:[]};
    byBatch[d.batchId].bags.push({id:bagId,loc:d.loc});
  });
  const batchEntries=Object.entries(byBatch).filter(([bid,d])=>!q||bid.toLowerCase().includes(q)||d.sp.toLowerCase().includes(q)||d.st.toLowerCase().includes(q));
  if(!batchEntries.length)return'';

  const cards=batchEntries.map(([bid,d])=>{
    d.bags.sort((a,b)=>(parseInt(a.id.split('-').pop())||0)-(parseInt(b.id.split('-').pop())||0));
    return`<div class="batch-card" style="--sp-color:${spColor(d.sp)}" onclick="this.classList.toggle('expanded')">
      <div class="batch-card-header">
        <span class="batch-card-species">${esc(d.sp)}</span>
        <span class="batch-card-count">${d.bags.length}</span>
      </div>
      <div class="batch-card-meta">
        <span style="font-family:monospace;font-size:10px">${esc(bid)}</span>
        <span>${esc(d.st)}</span>
      </div>
      <div class="batch-card-chips">${d.bags.map(bg=>{
        const sel=selectedLocBags.has(bg.id);
        return`<span class="bag-chip${sel?' selected':''}" data-bag="${esc(bg.id)}" data-batch="${esc(bid)}" data-loc="${esc(bg.loc)}">${bg.id.split('-').pop()}</span>`;
      }).join('')}</div>
    </div>`;
  }).join('');

  return`<div class="location-section contam-section">
    <div class="location-section-header">
      <div class="location-section-title"><span class="zone-dot" style="background:${zone.color}"></span>\u26a0 ${zoneDisplayName(zone.id)}</div>
      <span class="location-section-count">${tp('dash.bags',entries.length)}</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px">${cards}</div>
  </div>`;
}

function updateActionBar(){
  const bar=document.getElementById('loc-action-bar');
  if(!bar)return;
  const n=selectedLocBags.size;
  if(n>0){
    bar.style.display='flex';
    bar.innerHTML=`<span class="action-bar-count">${tp('dash.bagsSelected',n)}</span><span style="flex:1"></span>
      <button class="btn btn-sm" onclick="locSelectAllVisible()" style="font-size:11px">${t('dash.selectAll')}</button>
      <button class="btn btn-sm" onclick="selectedLocBags.clear();renderStatus()" style="font-size:11px">${t('dash.clear')}</button>
      <button class="btn btn-sm btn-p" onclick="openLocMovePopup()" style="font-size:11px">${t('dash.move')}</button>
      <button class="btn btn-sm btn-r" onclick="locRemoveSelected()" style="font-size:11px">${t('dash.remove')}</button>`;
  }else{
    bar.style.display='none';
  }
}

function locSelectAllVisible(){
  const q=(document.getElementById('status-q')?.value||'').toLowerCase();
  ZONES.forEach(z=>{
    const bags=getZoneBags(z);
    Object.entries(bags).forEach(([bagId,d])=>{
      if(!q||bagId.toLowerCase().includes(q)||(d.batchId||'').toLowerCase().includes(q)||(d.species||'').toLowerCase().includes(q)||(d.strain||'').toLowerCase().includes(q))
        selectedLocBags.set(bagId,{batchId:d.batchId,loc:d.loc});
    });
  });
  renderStatus();
}
function renderDashAlerts(){
  const invAlerts=getInvAlerts();
  const card=document.getElementById('dash-alerts-card');
  const el=document.getElementById('dash-alerts');
  if(!invAlerts.length){card.style.display='none';return}
  card.style.display='';
  el.innerHTML=invAlerts.map(tk=>`<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;font-size:12px;border-radius:6px;margin-bottom:3px;background:${tk.urgent?'var(--c-red-light)':'var(--c-amber-light)'};border-left:3px solid ${tk.urgent?'var(--c-red)':'var(--c-amber)'}"><div style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(tk.text)}</div><button class="btn btn-sm" onclick="go('inv','n-inv')" style="font-size:11px;padding:2px 8px">${t('inv.stock')}</button></div>`).join('');
}
function renderDashBatchTasks(){
  const filter=document.getElementById('dash-batch-filter')?.value||'all';
  const tasks=buildAutoTasks();
  const shown=filter==='urgent'?tasks.filter(tk=>tk.urgent||tk.warn):tasks;
  const el=document.getElementById('dash-batch-tasks');
  if(!el)return;
  if(!tasks.length){el.innerHTML='<div class="empty" style="padding:12px;text-align:center;color:var(--c-text-muted);font-size:13px">'+t('dash.noUrgent')+'</div>';return}
  el.innerHTML=shown.length?shown.map(tk=>'<div class="todo-row '+(tk.urgent?'urgent':tk.warn?'warn':'')+'" style="padding:6px 8px;margin-bottom:3px;--sp-color:'+spColor(tk.species)+'">'
    +(tk.urgent?'<span class="pdot high"></span>':tk.warn?'<span class="pdot med"></span>':'')
    +'<div style="flex:1"><div style="font-size:13px;font-weight:500">'+esc(tk.text)+'</div>'
    +'<div style="font-size:11px;color:var(--c-text-muted);margin-top:1px">'+esc(tk.detail)+'</div></div></div>').join('')
    :'<div class="empty" style="padding:12px;text-align:center;color:var(--c-text-muted);font-size:13px">'+t('dash.noUrgent')+'</div>';
}

// ─── RACKS ───────────────────────────────────────────────────
function getRackBags(rackId){
  const bags={};
  scanLog.forEach(e=>{
    if(e.action==='ADD'&&e.to===rackId&&e.bag)bags[e.bag]={batchId:e.batch,species:e.species,strain:e.strain};
    if(e.action==='MOVE'||e.action==='MOVE_BATCH'){if(e.to===rackId&&e.bag)bags[e.bag]={batchId:e.batch,species:e.species,strain:e.strain};if(e.from===rackId&&e.bag)delete bags[e.bag];}
    if(e.action==='REMOVE'&&e.from===rackId&&e.bag)delete bags[e.bag];
  });
  return bags;
}
function renderRacks(){renderStatus()}
function showRack(){}

// ─── LOCATION BAG INTERACTIONS ──────────────────────────────
const selectedLocBags=new Map(); // bagId → {batchId, loc}
function getZoneBags(zone){
  const bags={};
  scanLog.forEach(e=>{
    const tz=toZone(e.to),fz=toZone(e.from);
    if(e.action==='ADD'&&tz===zone&&e.bag)bags[e.bag]={batchId:e.batch,species:e.species,strain:e.strain,loc:e.to};
    if(e.action==='MOVE'||e.action==='MOVE_BATCH'){
      if(tz===zone&&e.bag)bags[e.bag]={batchId:e.batch,species:e.species,strain:e.strain,loc:e.to};
      if(fz===zone&&e.bag)delete bags[e.bag];
    }
    if(e.action==='REMOVE'&&fz===zone&&e.bag)delete bags[e.bag];
  });
  return bags;
}
function renderLocTabs(){renderStatus()}
function toggleLocBag(bagId,batchId,loc){
  if(selectedLocBags.has(bagId))selectedLocBags.delete(bagId);
  else selectedLocBags.set(bagId,{batchId,loc});
  // Toggle chip class
  const el=document.querySelector(`.bag-chip[data-bag="${CSS.escape(bagId)}"]`);
  if(el)el.classList.toggle('selected',selectedLocBags.has(bagId));
  updateActionBar();
}
function locSelectAll(){locSelectAllVisible()}
function openLocMovePopup(){
  if(!selectedLocBags.size)return;
  const n=selectedLocBags.size;
  // Determine source zone(s) for display
  const fromLocs=new Set();
  selectedLocBags.forEach(d=>fromLocs.add(toZone(d.loc)));
  const fromLabel=fromLocs.size===1?[...fromLocs][0]:'Mixed';
  const m=document.getElementById('m-locmove');
  document.getElementById('lm-title').textContent=tp('dash.bags',n);
  document.getElementById('lm-info').textContent=t('dash.currentlyIn',{loc:fromLabel});
  document.getElementById('lm-confirm').style.display='none';
  const grid=document.getElementById('lm-grid');
  grid.style.display='flex';
  grid.innerHTML='<div style="font-size:11px;font-weight:600;color:var(--c-text-muted);text-transform:uppercase;letter-spacing:.05em;width:100%;margin-bottom:2px">'+t('dash.zones')+'</div>'
    +ZONES.map(z=>{const zObj=zones.find(x=>x.id===z);return`<button class="btn btn-sm" onclick="locPreConfirm('${z}')" style="font-size:12px;padding:8px 12px;border-left:3px solid ${zObj?.color||'#888'}">${esc(zoneDisplayName(z))}</button>`}).join('')
    +(ALL_RACKS.length?'<div style="font-size:11px;font-weight:600;color:var(--c-text-muted);text-transform:uppercase;letter-spacing:.05em;width:100%;margin-top:8px;margin-bottom:2px">'+t('dash.racks')+'</div>':'')
    +ALL_RACKS.map(r=>`<button class="btn btn-sm" onclick="locPreConfirm('${r}')" style="font-size:11px;padding:6px 10px">${rackLabel(r)}</button>`).join('');
  m.classList.add('open');
}
function locPreConfirm(toLoc){
  document.getElementById('lm-grid').style.display='none';
  const c=document.getElementById('lm-confirm');
  c.style.display='block';
  const n=selectedLocBags.size;
  const ids=[...selectedLocBags.keys()];
  const preview=ids.length<=6?ids.map(id=>id.split('-').pop()).join(', '):ids.slice(0,5).map(id=>id.split('-').pop()).join(', ')+' + '+(ids.length-5)+' more';
  const fromLocs=new Set();
  selectedLocBags.forEach(d=>fromLocs.add(toZone(d.loc)));
  const fromLabel=fromLocs.size===1?[...fromLocs][0]:'Mixed';
  c.innerHTML=`<div style="text-align:center;padding:12px 0">
    <div style="font-size:14px;margin-bottom:8px">${t('dash.moveBags',{n:n})}</div>
    <div style="font-size:11px;color:var(--c-text-muted);margin-bottom:8px;font-family:monospace">${preview}</div>
    <div style="font-size:20px;margin-bottom:16px">${esc(fromLabel)} \u2192 <strong>${esc(toLoc)}</strong></div>
    <div style="display:flex;gap:8px;justify-content:center">
      <button class="btn" onclick="openLocMovePopup()" style="min-width:100px">${t('nav.cancel')}</button>
      <button class="btn btn-p" onclick="locMoveTo('${toLoc}')" style="min-width:100px">${t('confirm.confirm')}</button>
    </div>
  </div>`;
}
function renderLocBody(){renderStatus()}
// Event delegation for bag chip clicks
document.getElementById('dash-locations').addEventListener('click',function(e){
  const chip=e.target.closest('.bag-chip[data-bag]');
  if(!chip)return;
  e.preventDefault();e.stopPropagation();
  toggleLocBag(chip.dataset.bag,chip.dataset.batch,chip.dataset.loc);
});
let lastLocUndoCount=0;
function locMoveTo(toLoc){
  if(!selectedLocBags.size)return;
  const now=new Date().toISOString();
  const n=selectedLocBags.size;const entries=[];
  selectedLocBags.forEach((d,bagId)=>{
    const b=batches.find(x=>x.batchId===d.batchId);
    const entry={time:now,action:'MOVE',batch:d.batchId,bag:bagId,from:d.loc,to:toLoc,species:b?.species||null,strain:b?.strain||null,user:currentUser?.username||null};scanLog.push(entry);movements.push(entry);entries.push(entry);
    scan.count++;
  });
  lastLocUndoCount=n;
  selectedLocBags.clear();document.getElementById('m-locmove').classList.remove('open');
  apiPost('/api/scan-log',{entries});updateSD();renderStatus();
  setLocFb(t('scanFb.moved',{n:n,loc:toLoc}));
}
function locRemoveSelected(){
  if(!selectedLocBags.size)return;
  const n=selectedLocBags.size;
  if(!confirm(t('scanFb.confirmRemove',{n:n})))return;
  const now=new Date().toISOString();
  const entries=[];selectedLocBags.forEach((d,bagId)=>{
    const b=batches.find(x=>x.batchId===d.batchId);const entry={time:now,action:'REMOVE',batch:d.batchId,bag:bagId,from:d.loc,to:null,species:b?.species||null,strain:b?.strain||null,user:currentUser?.username||null};scanLog.push(entry);movements.push(entry);entries.push(entry);
    scan.count++;
  });
  lastLocUndoCount=n;
  selectedLocBags.clear();document.getElementById('m-locmove').classList.remove('open');
  apiPost('/api/scan-log',{entries});updateSD();renderStatus();
  setLocFb(t('scanFb.removed',{n:n}));
}
function setLocFb(msg){
  const el=document.getElementById('scan-toast');
  el.className='scan-toast fb-ok visible';
  el.innerHTML=msg+' <button onclick="locUndo()" style="margin-left:8px;font-size:11px;padding:2px 10px;border:1px solid #888;border-radius:4px;background:#fff;cursor:pointer;font-weight:600;pointer-events:auto">Undo</button>';
  clearTimeout(_toastTimer);
  _toastTimer=setTimeout(()=>el.classList.remove('visible'),5000);
}
function locUndo(){
  if(!lastLocUndoCount)return;
  const n2=lastLocUndoCount;scanLog.splice(scanLog.length-n2,n2);
  lastLocUndoCount=0;
  apiDelete('/api/scan-log/last/'+n2);updateSD();renderStatus();
  setFb('ok','Undo successful');
}

// ─── BATCHES ─────────────────────────────────────────────────
function nbTypeChange(){nbPreview()}
function setBagWeight(kg){
  document.getElementById('nb-weight').value=kg;
  // Highlight the active button
  ['wbtn-3','wbtn-5'].forEach(id=>{
    const btn=document.getElementById(id);
    if(!btn)return;
    const btnKg=parseFloat(btn.textContent);
    btn.className='btn btn-sm'+(btnKg===kg?' btn-p':'');
  });
  nbPreview();
}
function nbPreview(){
  const strainSel=document.getElementById('nb-strain-sel');
  const strainId=strainSel?parseInt(strainSel.value)||null:null;
  const ms=strainId?mushroomStrains.find(x=>x.id===strainId):null;
  const sp=ms?ms.name:'',st=ms?ms.kuerzel:'';
  const qty=parseInt(document.getElementById('nb-qty').value)||0;
  document.getElementById('nb-prev').textContent=(sp&&st)?genBatchId(sp)+' ('+qty+' bags)':'—';
  const bagKg=parseFloat(document.getElementById('nb-weight').value)||0;
  if(!qty||!bagKg){document.getElementById('nb-mat-preview').style.display='none';return}
  let lines=[];
  {
    const hw=parseFloat(document.getElementById('nb-hw').value)||0;
    const wb=parseFloat(document.getElementById('nb-wb').value)||0;
    const rh=parseFloat(document.getElementById('nb-rh').value)||0;
    const gyp=document.getElementById('nb-gyp').checked;
    if(hw||wb){
      // Correct calculation: subtract water first, then split dry matter
      // dryKg = bagKg × (1 - rh/100)
      const dryKg = rh>0 ? bagKg*(1-rh/100) : bagKg;
      const hwKg=qty*dryKg*(hw/100);
      const wbKg=qty*dryKg*(wb/100);
      const gypKg=gyp?qty*dryKg*0.01:0;
      const hwStock=inventory.stock?.hardwood||0;
      const wbStock=inventory.stock?.wheatbran||0;
      const gypStock=inventory.stock?.gypsum||0;
      if(rh>0) lines.push(`<strong>Bag:</strong> ${bagKg}kg total → ${dryKg.toFixed(3)}kg dry matter per bag (${rh}% water removed)`);
      if(hw) lines.push(`<strong>Hardwood (${hw}%):</strong> ${hwKg.toFixed(3)} kg needed — ${hwStock.toFixed(2)} kg in stock ${hwStock>=hwKg?'✓':'⚠ short by '+(hwKg-hwStock).toFixed(2)+'kg'}`);
      if(wb) lines.push(`<strong>Wheat bran (${wb}%):</strong> ${wbKg.toFixed(3)} kg needed — ${wbStock.toFixed(2)} kg in stock ${wbStock>=wbKg?'✓':'⚠ short by '+(wbKg-wbStock).toFixed(2)+'kg'}`);
      if(gyp) lines.push(`<strong>Gypsum (~1%):</strong> ${gypKg.toFixed(3)} kg needed — ${gypStock.toFixed(2)} kg in stock ${gypStock>=gypKg?'✓':'⚠'}`);
      lines.push(`<strong>Total dry matter per bag:</strong> ${dryKg.toFixed(3)} kg`);
    }
  }
  const el=document.getElementById('nb-mat-preview');
  if(lines.length){el.innerHTML=lines.join('<br>');el.style.display='block';}
  else el.style.display='none';
}
function nbSubSum(){const hw=parseFloat(document.getElementById('nb-hw').value)||0,wb=parseFloat(document.getElementById('nb-wb').value)||0,s=hw+wb;document.getElementById('nb-subsum').textContent=(hw||wb)?'Total: '+s+'%'+(s!==100?' — should add up to 100%':''):'';nbPreview()}
function createBatch(){
  const strainSel=document.getElementById('nb-strain-sel');
  const strainId=strainSel?parseInt(strainSel.value)||null:null;
  const ms=strainId?mushroomStrains.find(x=>x.id===strainId):null;
  if(!strainId||!ms){alert(t('strains.noStrainsHint'));return}
  const sp=ms.name,st=ms.kuerzel;
  const qty=parseInt(document.getElementById('nb-qty').value)||0,days=parseInt(document.getElementById('nb-days').value)||14;
  const bagKg=parseFloat(document.getElementById('nb-weight').value)||0;
  if(qty<1){alert('Please fill in quantity');return}
  if(!bagKg){alert('Please enter a bag weight');return}
  const hw=parseFloat(document.getElementById('nb-hw').value)||0,wb=parseFloat(document.getElementById('nb-wb').value)||0;
  const substrate=(hw||wb)?{hardwood:hw,wheatbran:wb,rh:parseFloat(document.getElementById('nb-rh').value)||null,gypsum:document.getElementById('nb-gyp').checked}:null;
  const strainText=(document.getElementById('nb-strain-text')||{}).value?.trim()||'';
  const batchId=genBatchId(sp);spColor(sp);
  const due=new Date();due.setDate(due.getDate()+days);
  const bags=Array.from({length:qty},(_,i)=>batchId+'-'+String(i+1).padStart(2,'0'));
  const batchType='block';
  batches.push({batchId,species:sp,strain:st,strainId,strainName:ms.name,strainKuerzel:ms.kuerzel,qty,days,substrate,bagKg,batchType,sourceId:document.getElementById('nb-culture').value||null,notes:document.getElementById('nb-notes').value.trim(),strainText,created:new Date().toISOString(),due:due.toISOString(),bags});

  // Save batch to server
  const batchObj=batches[batches.length-1];
  apiPost('/api/batches',batchObj).then(r=>{
    if(r&&r.error){
      // Rollback local state so UI reflects server truth (e.g. duplicate batchId)
      const i=batches.findIndex(b=>b.batchId===batchObj.batchId);
      if(i>=0)batches.splice(i,1);
      alert('Batch konnte nicht gespeichert werden: '+r.error);
      renderBatches();renderStatus();
    }
    // Register new barcode numbers from server response
    if(r&&r.bagBarcodes){for(const[id,bc]of Object.entries(r.bagBarcodes)){barcodeRegistry.set(bc,{type:'bag',id});barcodeByEntity.set('bag:'+id,bc)}}
  });

  // Auto-deduct materials from inventory via server-side deltas
  if(!inventory.stock)inventory.stock={hardwood:0,wheatbran:0,gypsum:0,grain:0};
  const deltas=[];
  if(substrate){
    const rh=parseFloat(document.getElementById('nb-rh').value)||0;
    const dryKgPerBag=rh>0?bagKg*(1-rh/100):bagKg;
    const hwUsed=qty*dryKgPerBag*(hw/100);
    const wbUsed=qty*dryKgPerBag*(wb/100);
    if(hwUsed>0){inventory.stock.hardwood=Math.max(0,inventory.stock.hardwood-hwUsed);deltas.push({mat:'hardwood',deltaKg:-hwUsed,type:'batch',ref:batchId})}
    if(wbUsed>0){inventory.stock.wheatbran=Math.max(0,inventory.stock.wheatbran-wbUsed);deltas.push({mat:'wheatbran',deltaKg:-wbUsed,type:'batch',ref:batchId})}
    if(substrate.gypsum){const gypUsed=qty*dryKgPerBag*0.01;inventory.stock.gypsum=Math.max(0,inventory.stock.gypsum-gypUsed);deltas.push({mat:'gypsum',deltaKg:-gypUsed,type:'batch',ref:batchId})}
  }
  if(deltas.length)invDeltas(deltas);
  if(document.getElementById('nb-strain-sel'))document.getElementById('nb-strain-sel').value='';
  const nbStrainTextEl=document.getElementById('nb-strain-text');if(nbStrainTextEl)nbStrainTextEl.value='';
  document.getElementById('nb-qty').value='10';document.getElementById('nb-days').value='14';
  document.getElementById('nb-notes').value='';document.getElementById('nb-mat-preview').style.display='none';
  nbPreview();updateTodoBadge();
  // Show zone picker — required before print
  openZonePickModal(batchObj,bags,function(){
    document.getElementById('nb-bags').innerHTML=bags.map(b=>`<span style="font-size:10px;font-family:monospace;background:var(--c-bg);padding:2px 6px;border-radius:4px;color:var(--c-text-sec)">${esc(b)}</span>`).join('');
    document.getElementById('nb-result').style.display='block';
  });
}
function goToPrintBatch(){go('print','n-print');setTimeout(()=>{openStab('print','bags');fillBatchSelect();const s=document.getElementById('print-batch'),last=batches[batches.length-1];if(last){s.value=last.batchId;renderBagPreview()}},100)}
// Move all active bags in a batch to a destination zone/rack.
// Shared by the scan engine (MOVE_BATCH action) and the batch list dropdown.
// Calls back with (movedCount, skippedCount) when done.
function moveBatchTo(batch,dest,cb){
  const now=new Date().toISOString();const entries=[];let skipped=0;
  batch.bags.forEach(bagId=>{
    const bagLast=[...scanLog].reverse().find(e=>(e.bag||'').toUpperCase()===bagId.toUpperCase()&&(e.action==='ADD'||e.action==='MOVE'||e.action==='REMOVE'));
    if(!bagLast||bagLast.action==='REMOVE')return;
    const curLoc=bagLast.to||null;
    if(curLoc&&curLoc.toUpperCase()===dest.toUpperCase()){skipped++;return}
    const tempId='s'+(++_scanTempIdCounter);
    const entry={time:now,action:'MOVE',batch:batch.batchId,bag:bagId,from:curLoc,to:dest,species:batch.species,strain:batch.strain,user:currentUser?.username||null,_tempId:tempId};
    scanLog.push(entry);movements.push(entry);entries.push(entry);
    if(!sessionStartTime)sessionStartTime=Date.now();
    sessionEntries.push(entry);
  });
  if(!entries.length){if(cb)cb(0,skipped);return}
  if(scanChannel)entries.forEach(e=>scanChannel.postMessage({type:'scan-entry',entry:{bag:e.bag,batch:e.batch,action:e.action,to:e.to}}));
  apiPost('/api/scan-log',{entries}).then(function(r){if(r&&r.ids)entries.forEach((e,i)=>{if(r.ids[i])e._serverId=r.ids[i]})});
  if(cb)cb(entries.length,skipped);
}

// Add all bags in bagIds to a location (initial placement — ADD action, from=null).
function addBagsToLocation(batch,bagIds,dest,cb){
  const now=new Date().toISOString();const entries=[];
  bagIds.forEach(bagId=>{
    const tempId='s'+(++_scanTempIdCounter);
    const entry={time:now,action:'ADD',batch:batch.batchId,bag:bagId,from:null,to:dest,species:batch.species,strain:batch.strain,user:currentUser?.username||null,_tempId:tempId};
    scanLog.push(entry);movements.push(entry);entries.push(entry);
    if(!sessionStartTime)sessionStartTime=Date.now();
    sessionEntries.push(entry);
  });
  if(!entries.length){if(cb)cb(0);return}
  if(scanChannel)entries.forEach(e=>scanChannel.postMessage({type:'scan-entry',entry:{bag:e.bag,batch:e.batch,action:e.action,to:e.to}}));
  apiPost('/api/scan-log',{entries}).then(function(r){if(r&&r.ids)entries.forEach((e,i)=>{if(r.ids[i])e._serverId=r.ids[i]})});
  if(cb)cb(entries.length);
}

// Zone picker modal — shown after batch creation, user must pick a destination.
// onDone() is called after a zone is picked so the caller can show print panel.
function openZonePickModal(batch,bags,onDone){
  const m=document.getElementById('m-zone-pick');if(!m)return;
  document.getElementById('zp-title').textContent=t('batch.whereGo');
  document.getElementById('zp-info').textContent=t('batch.whereGoInfo',{id:batch.batchId,n:bags.length});
  const container=document.getElementById('zp-zones');
  container.innerHTML='';
  if(!zones.length){
    container.innerHTML='<div style="color:var(--c-text-muted);font-style:italic;font-size:13px">'+esc(t('batch.noLocations'))+'</div>';
  }else{
    zones.forEach(z=>{
      const wrap=document.createElement('div');
      wrap.style.cssText='display:flex;align-items:center;gap:8px;background:var(--c-bg);border-radius:8px;padding:10px 12px';
      // Zone button
      const btn=document.createElement('button');
      btn.type='button';btn.className='btn btn-p';
      btn.textContent=z.name||z.id;
      btn.style.cssText='flex:1;min-width:0;text-align:left;font-weight:600';
      // Optional rack selector
      let rackSel=null;
      if(z.racks&&z.racks.length){
        rackSel=document.createElement('select');
        rackSel.style.cssText='font-size:12px;max-width:120px';
        rackSel.innerHTML='<option value="">\u2014 '+esc(t('zones.noRacks'))+' \u2014</option>'+z.racks.map(r=>`<option value="${esc(r.id)}">${esc(r.id.slice(z.id.length+1)||r.id)}</option>`).join('');
        wrap.appendChild(rackSel);
      }
      btn.addEventListener('click',function(){
        const dest=rackSel&&rackSel.value?rackSel.value:z.id;
        m.style.display='none';
        addBagsToLocation(batch,bags,dest,function(added){
          setFb('ok',batch.batchId+': '+added+' Bags \u2192 '+zoneDisplayName(dest));
          updateSD();renderBatches();renderStatus();
        });
        if(onDone)onDone();
      });
      wrap.insertBefore(btn,wrap.firstChild);
      container.appendChild(wrap);
    });
  }
  m.style.display='flex';
}

// Move-batch modal — select destination for an entire batch from Alle Chargen.
function openMoveBatchModal(batchId){
  const b=batches.find(x=>x.batchId===batchId);if(!b)return;
  const m=document.getElementById('m-move-batch');if(!m)return;
  document.getElementById('mb-title').textContent=t('batch.moveMenuTitle',{id:batchId});
  const container=document.getElementById('mb-zones');
  container.innerHTML='';
  if(!zones.length){
    container.innerHTML='<div style="padding:8px 0;color:var(--c-text-muted);font-style:italic">'+esc(t('batch.noLocations'))+'</div>';
  }else{
    zones.forEach(z=>{
      // Zone row
      const zRow=document.createElement('button');
      zRow.type='button';
      zRow.style.cssText='display:block;width:100%;text-align:left;background:none;border:0;padding:8px 10px;font:inherit;cursor:pointer;font-size:13px;font-weight:600;border-radius:6px;border-left:3px solid '+(z.color||'#888');
      zRow.textContent=z.name||z.id;
      zRow.addEventListener('mouseenter',()=>{zRow.style.background='var(--c-bg)'});
      zRow.addEventListener('mouseleave',()=>{zRow.style.background='none'});
      zRow.addEventListener('click',()=>{
        document.getElementById('m-move-batch').classList.remove('open');
        moveBatchTo(b,z.id,function(moved,skipped){
          if(!moved){setFb('err','Keine Bags zu verschieben'+(skipped?' ('+skipped+' bereits in '+zoneDisplayName(z.id)+')':''));return}
          setFb('ok',b.batchId+': '+moved+' Bags \u2192 '+zoneDisplayName(z.id)+(skipped?' ('+skipped+' \u00fcbersprungen)':''));
          updateSD();renderBatches();
        });
      });
      container.appendChild(zRow);
      // Rack rows
      (z.racks||[]).forEach(r=>{
        const rRow=document.createElement('button');
        rRow.type='button';
        rRow.style.cssText='display:block;width:100%;text-align:left;background:none;border:0;padding:5px 10px 5px 22px;font:inherit;cursor:pointer;font-size:12px;font-family:monospace;border-radius:6px;color:var(--c-text-sec)';
        rRow.textContent=r.id.slice(z.id.length+1)||r.id;
        rRow.addEventListener('mouseenter',()=>{rRow.style.background='var(--c-bg)'});
        rRow.addEventListener('mouseleave',()=>{rRow.style.background='none'});
        rRow.addEventListener('click',()=>{
          document.getElementById('m-move-batch').classList.remove('open');
          moveBatchTo(b,r.id,function(moved,skipped){
            if(!moved){setFb('err','Keine Bags zu verschieben'+(skipped?' ('+skipped+' bereits in '+zoneDisplayName(r.id)+')':''));return}
            setFb('ok',b.batchId+': '+moved+' Bags \u2192 '+zoneDisplayName(r.id)+(skipped?' ('+skipped+' \u00fcbersprungen)':''));
            updateSD();renderBatches();
          });
        });
        container.appendChild(rRow);
      });
    });
  }
  document.getElementById('m-move-batch').classList.add('open');
}

function renderBatches(){
  const q=(document.getElementById('batch-q').value||'').toLowerCase(),body=document.getElementById('batches-body');
  if(!batches.length){body.innerHTML='<tr><td colspan="12" class="empty">'+t('dash.noBatches')+'</td></tr>';return}
  body.innerHTML=batches.filter(b=>!q||b.batchId.toLowerCase().includes(q)||(b.species||'').toLowerCase().includes(q)||(b.strain||'').toLowerCase().includes(q)||(b.strainName||'').toLowerCase().includes(q)).map(b=>{
    const{status}=getStatus(b.batchId);
    const sub=b.substrate?[`<span class="sub-tag">HW ${b.substrate.hardwood}% WB ${b.substrate.wheatbran}%</span>`,b.substrate.rh?`<span class="sub-tag">RH ${b.substrate.rh}%</span>`:'',b.substrate.gypsum?`<span class="sub-tag" style="background:var(--c-primary-light);color:var(--c-green-dark)">Gypsum</span>`:''].join(''):'<span style="color:#ccc;font-size:11px">—</span>';
    const src=b.sourceId?`<span style="font-family:monospace;font-size:10px;color:var(--c-purple-dark)">${esc(b.sourceId)}</span>`:'<span style="color:#ccc;font-size:11px">—</span>';
    const note=b.notes?`<span style="font-size:11px;color:var(--c-text-sec);cursor:pointer" data-action="open-note" data-batch="${esc(b.batchId)}">${esc(b.notes.length>22?b.notes.slice(0,22)+'\u2026':b.notes)}</span>`:`<span style="font-size:11px;color:#bbb;cursor:pointer;font-style:italic" data-action="open-note" data-batch="${esc(b.batchId)}">${t('batch.addNote')}</span>`;
    const strainDisplay=b.strainName?(esc(b.strainName)+(b.strainKuerzel?' <span style="font-size:10px;color:var(--c-text-muted)">('+esc(b.strainKuerzel)+')</span>':'')):esc(b.strain||'—');
    const canMove=status!=='DONE';
    const moveBtn=canMove?`<button class="btn btn-sm" data-action="open-move-modal" data-batch="${esc(b.batchId)}" style="margin-right:3px">&#10554; ${t('batch.moveTo')}</button>`:'';
    const renameBtn=currentUser&&currentUser.role==='admin'?`<button class="btn btn-sm" data-action="rename-batch" data-batch="${esc(b.batchId)}" style="margin-right:3px">\u270e ${t('batch.rename')}</button>`:'';
    return`<tr><td style="font-family:monospace;font-size:10px"><span data-action="toggle-bags" data-batch="${esc(b.batchId)}" style="cursor:pointer;user-select:none" id="btog-${esc(b.batchId)}">&#9654;</span> ${esc(b.batchId)}</td><td>${spDot(b.species)}${esc(b.species)}</td><td>${strainDisplay}</td><td>${b.qty}</td><td>${b.days}d</td><td>${sub}</td><td>${src}</td><td style="font-size:10px;color:var(--c-text-muted)">${fmtDt(b.created)}</td><td style="font-size:10px;color:var(--c-text-muted)">${fmtDt(b.due)}</td><td>${sbadge(status)}</td><td>${note}</td><td style="white-space:nowrap">${moveBtn}<button class="btn btn-sm" data-action="add-bags" data-batch="${esc(b.batchId)}" style="margin-right:3px">${t('batch.addBags')}</button>${renameBtn}<button class="btn btn-sm btn-r" data-action="del-batch" data-batch="${esc(b.batchId)}">${t('batch.del')}</button></td></tr>`;
  }).join('')||'<tr><td colspan="12" class="empty">'+t('dash.noMatches')+'</td></tr>';
}
let locColor={};
function toggleBatchBags(batchId){
  const existing=document.getElementById('brow-'+batchId);
  if(existing){existing.remove();document.getElementById('btog-'+batchId).innerHTML='&#9654;';return}
  const b=batches.find(x=>x.batchId===batchId);if(!b)return;
  document.getElementById('btog-'+batchId).innerHTML='&#9660;';
  const parentRow=document.getElementById('btog-'+batchId).closest('tr');
  const tr=document.createElement('tr');tr.id='brow-'+batchId;
  const td=document.createElement('td');td.colSpan=12;td.style.cssText='background:var(--c-bg);padding:8px 12px';
  td.innerHTML='<div style="display:flex;flex-wrap:wrap;gap:4px">'+b.bags.map(bag=>{
    const last=[...scanLog].reverse().find(e=>(e.bag||'').toUpperCase()===bag.toUpperCase());
    let loc='—',color='#aaa';
    if(last){
      if(last.action==='REMOVE'){loc=t('bagInfo.removed');color='#999'}
      else if(last.to){loc=zoneDisplayName(last.to);const z=toZone(last.to);color=locColor[z]||'#888'}
    }
    const num=bag.split('-').pop();
    return`<span style="font-size:10px;font-family:monospace;padding:3px 7px;border-radius:5px;background:#fff;border:1px solid var(--c-border);display:inline-flex;align-items:center;gap:3px${last&&last.action==='REMOVE'?';text-decoration:line-through;opacity:.5':''}">
      ${num} <span style="font-size:9px;color:${color};font-weight:600">${loc}</span>
    </span>`;
  }).join('')+'</div>';
  tr.appendChild(td);parentRow.after(tr);
}
let addBagsBatchId=null;
let _lastNewBags=[];
function openAddBags(batchId){
  const b=batches.find(x=>x.batchId===batchId);
  if(!b)return;
  addBagsBatchId=batchId;
  document.getElementById('ab-phase-input').style.display='';
  document.getElementById('ab-phase-result').style.display='none';
  document.getElementById('m-addbags-title').textContent=t('addBags.title');
  document.getElementById('ab-info').textContent=t('addBags.info',{id:batchId,n:b.bags.length,last:b.bags[b.bags.length-1]});
  document.getElementById('ab-qty').value=1;
  document.getElementById('ab-preview').style.display='none';
  document.getElementById('m-addbags').classList.add('open');
  setTimeout(()=>document.getElementById('ab-qty').focus(),80);
}
function confirmAddBags(){
  const b=batches.find(x=>x.batchId===addBagsBatchId);
  if(!b)return;
  const qty=parseInt(document.getElementById('ab-qty').value)||0;
  if(qty<1){alert(t('addBags.enterQty'));return}
  const lastNum=parseInt(b.bags[b.bags.length-1].split('-').pop())||b.bags.length;
  const newBags=Array.from({length:qty},(_,i)=>b.batchId+'-'+String(lastNum+1+i).padStart(2,'0'));
  b.bags=[...b.bags,...newBags];
  b.qty=b.bags.length;
  _lastNewBags=newBags;
  apiPatch('/api/batches/'+encodeURIComponent(b.batchId)+'/bags',{add:newBags,newQty:b.qty}).then(r=>{if(r&&r.bagBarcodes){for(const[id,bc]of Object.entries(r.bagBarcodes)){barcodeRegistry.set(bc,{type:'bag',id});barcodeByEntity.set('bag:'+id,bc)}}});
  // Switch to result phase
  document.getElementById('ab-phase-input').style.display='none';
  document.getElementById('m-addbags-title').textContent=t('addBags.addedTitle');
  document.getElementById('ab-result-info').textContent=t('addBags.added',{qty:qty,id:b.batchId,total:b.bags.length});
  document.getElementById('ab-new-bags').innerHTML=newBags.map(id=>
    '<span style="font-size:10px;font-family:monospace;background:var(--c-bg);padding:2px 6px;border-radius:4px;color:var(--c-text-sec)">'+esc(id)+'</span>'
  ).join('');
  document.getElementById('ab-phase-result').style.display='';
  renderBatches();
}
async function printNewBags(){
  const b=batches.find(x=>x.batchId===addBagsBatchId);
  if(!b||!_lastNewBags.length)return;
  const zpl=makeBagZPL(_lastNewBags,b,'full');
  const err=await sendToPrinter(zpl);
  if(err){
    const blob=new Blob([zpl],{type:'text/plain'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=b.batchId+'_new_labels.zpl';a.click();
  }else{
    setFb('ok',t('addBags.printed',{n:_lastNewBags.length,id:b.batchId}));
  }
  document.getElementById('m-addbags').classList.remove('open');
}
document.getElementById('m-addbags').addEventListener('click',e=>{if(e.target.id==='m-addbags')document.getElementById('m-addbags').classList.remove('open')});

function delBatch(id){confirm2(t('batch.deleteBatch',{id:id}),t('batch.deleteMsg'),t('batch.deleteBtn'),()=>{
  const b=batches.find(x=>x.batchId===id);
  // Reverse inventory deductions locally
  if(b&&inventory.stock){
    if(b.batchType==='grain'){
      inventory.stock.grain=(inventory.stock.grain||0)+b.qty*(b.bagKg||3);
    }else if(b.substrate){
      const rh=b.substrate.rh||0,bagKg=b.bagKg||3;
      const dryKgPerBag=rh>0?bagKg*(1-rh/100):bagKg;
      if(b.substrate.hardwood)inventory.stock.hardwood=(inventory.stock.hardwood||0)+b.qty*dryKgPerBag*(b.substrate.hardwood/100);
      if(b.substrate.wheatbran)inventory.stock.wheatbran=(inventory.stock.wheatbran||0)+b.qty*dryKgPerBag*(b.substrate.wheatbran/100);
      if(b.substrate.gypsum)inventory.stock.gypsum=(inventory.stock.gypsum||0)+b.qty*dryKgPerBag*0.01;
    }
  }
  batches=batches.filter(x=>x.batchId!==id);apiDelete('/api/batches/'+encodeURIComponent(id));renderBatches();renderStatus();
})}

function openBatchRenameModal(oldId){
  const m=document.getElementById('m-batch-rename');if(!m)return;
  document.getElementById('br-title').textContent=t('batch.renameTitle',{id:oldId});
  document.getElementById('br-old-id').textContent=oldId;
  const inp=document.getElementById('br-new-id');
  inp.value=oldId;
  m.classList.add('open');
  setTimeout(()=>{inp.select()},50);
  document.getElementById('br-confirm-btn').onclick=()=>{
    const newId=inp.value.trim();
    if(!newId||newId===oldId){m.classList.remove('open');return}
    if(!/^[A-Za-z0-9_\-@.:]{1,100}$/.test(newId)){alert('ID darf nur Buchstaben, Zahlen und - _ @ . : enthalten (max 100 Zeichen)');return}
    doBatchRename(oldId,newId,m);
  };
}
async function doBatchRename(oldId,newId,modal){
  try{
    const r=await apiPost('/api/batches/'+encodeURIComponent(oldId)+'/rename',{newId});
    if(r&&r.error){alert(r.error);return}
    // Update all in-memory references
    batches.forEach(b=>{
      if(b.batchId===oldId){
        b.batchId=newId;
        b.bags=b.bags.map(bag=>bag.replace(oldId,newId));
      }
    });
    scanLog.forEach(e=>{
      if(e.batch===oldId){e.batch=newId;if(e.bag)e.bag=e.bag.replace(oldId,newId)}
    });
    movements.forEach(e=>{
      if(e.batch===oldId){e.batch=newId;if(e.bag)e.bag=e.bag.replace(oldId,newId)}
    });
    harvests.forEach(h=>{
      if(h.batch===oldId){h.batch=newId;if(h.bag)h.bag=h.bag.replace(oldId,newId)}
    });
    if(modal)modal.classList.remove('open');
    setFb('ok',t('batch.renameSuccess',{old:oldId,new:newId}));
    renderBatches();renderStatus();
  }catch(e){alert('Fehler: '+e.message)}
}

// ─── HARVESTS ────────────────────────────────────────────────
function showHarvestPanel(bagId,batchId){
  const b=batches.find(x=>x.batchId===batchId);
  scan.harvestBag={bagId,batchId,species:b?.species,strain:b?.strain};
  document.getElementById('hp-lbl').textContent=t('harvest.logHarvest')+' \u2014 '+bagId;
  document.getElementById('hp-bag').value=bagId;document.getElementById('hp-grams').value='';
  closeCamScan();
  closeScanModal();
  document.getElementById('harvest-panel').style.display='block';
  setTimeout(()=>document.getElementById('hp-grams').focus(),80);
  setFb('harvest',t('harvest.bagScanned',{bag:bagId}),{noModal:true});
}
function confirmHarvest(){
  const g=parseFloat(document.getElementById('hp-grams').value),f=parseInt(document.getElementById('hp-flush').value)||1;
  if(!g||g<=0){alert(t('harvest.enterWeight'));return}
  const p=scan.harvestBag;
  const tempId='s'+(++_scanTempIdCounter);
  const hEntry={time:new Date().toISOString(),batch:p.batchId,bag:p.bagId,species:p.species,strain:p.strain,grams:g,flush:f};
  harvests.push(hEntry);apiPost('/api/harvests',hEntry);
  // Track in sessionEntries so session summary counts HARVEST and it appears in the log
  const sEntry={time:hEntry.time,action:'HARVEST',batch:p.batchId,bag:p.bagId,from:null,to:null,species:p.species,strain:p.strain,grams:g,flush:f,_tempId:tempId};
  if(!sessionStartTime)sessionStartTime=Date.now();
  sessionEntries.push(sEntry);
  scan.harvestBag=null;scan.count++;
  document.getElementById('harvest-panel').style.display='none';
  setFb('ok',t('harvest.logged',{bag:p.bagId,g:g,f:f}),sEntry);updateSD();
}
function cancelHarvest(){scan.harvestBag=null;document.getElementById('harvest-panel').style.display='none';setFb('info',t('harvest.cancelled'))}
document.getElementById('hp-grams').addEventListener('keydown',e=>{if(e.key==='Enter')confirmHarvest()});
function renderHarvests(){
  const q=(document.getElementById('harvest-q').value||'').toLowerCase(),body=document.getElementById('harvest-body');
  const items=[...harvests].reverse().filter(h=>!q||h.batch.toLowerCase().includes(q)||(h.species||'').toLowerCase().includes(q)).slice(0,200);
  body.innerHTML=items.length?items.map(h=>`<tr><td style="font-size:10px;color:var(--c-text-muted)">${fmtDtTime(h.time)}</td><td style="font-family:monospace;font-size:10px">${esc(h.batch)||'\u2014'}</td><td style="font-family:monospace;font-size:10px">${esc(h.bag)||'\u2014'}</td><td>${h.species?spDot(h.species)+esc(h.species):'\u2014'}</td><td>${esc(h.strain)||'\u2014'}</td><td>${h.flush||1}</td><td style="font-weight:500;color:var(--c-amber-dark)">${h.grams}g</td></tr>`).join(''):'<tr><td colspan="7" class="empty">'+t('harvest.noHarvests')+'</td></tr>';

  const byBatch={};
  harvests.forEach(h=>{if(!byBatch[h.batch])byBatch[h.batch]={total:0,flushes:{},species:h.species};byBatch[h.batch].total+=h.grams;byBatch[h.batch].flushes[h.flush]=(byBatch[h.batch].flushes[h.flush]||0)+h.grams});
  const ids=Object.keys(byBatch).sort((a,b)=>byBatch[b].total-byBatch[a].total);
  const tot=harvests.reduce((s,h)=>s+h.grams,0);
  document.getElementById('harvest-metrics').innerHTML=ids.length?[
    [t('harvest.totalHarvested'),tot>=1000?(tot/1000).toFixed(1)+'kg':tot+'g'],
    [t('harvest.batchesWithYield'),ids.length],
    [t('harvest.topBatch'),ids[0]?byBatch[ids[0]].total+'g':'\u2014']
  ].map(([l,v])=>`<div class="met"><div class="met-l">${l}</div><div class="met-v" style="font-size:16px;color:var(--c-amber-dark)">${v}</div></div>`).join(''):'';

  if(!ids.length){
    document.getElementById('harvest-totals').innerHTML='<div class="empty">'+t('harvest.noData')+'</div>';
    return;
  }

  // Bar chart: yield per batch
  const batchYieldCanvas=document.getElementById('batch-yield-chart');
  if(batchYieldCanvas){
    if(batchYieldInst){batchYieldInst.destroy();batchYieldInst=null}
    batchYieldInst=new Chart(batchYieldCanvas,{
      type:'bar',
      data:{
        labels:ids.slice(0,12),
        datasets:[{label:'Grams',data:ids.slice(0,12).map(id=>byBatch[id].total),backgroundColor:ids.slice(0,12).map(id=>spColor(byBatch[id].species)),borderRadius:5,borderSkipped:false}]
      },
      options:{responsive:true,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed.y+'g'}}},scales:{y:{ticks:{callback:v=>v+'g'},grid:{color:'#f0ede8'}},x:{ticks:{font:{size:9}},grid:{display:false}}}}
    });
  }

  // Line chart: harvest over time by week
  const byWeek={};
  harvests.forEach(h=>{
    const d=new Date(h.time);
    const mon=new Date(d);mon.setDate(d.getDate()-d.getDay()+1);
    const key=mon.toISOString().slice(0,10);
    byWeek[key]=(byWeek[key]||0)+h.grams;
  });
  const weekKeys=Object.keys(byWeek).sort();
  const timelineCanvas=document.getElementById('harvest-timeline-chart');
  if(timelineCanvas){
    if(timelineInst){timelineInst.destroy();timelineInst=null}
    timelineInst=new Chart(timelineCanvas,{
      type:'line',
      data:{
        labels:weekKeys.map(k=>{const d=new Date(k);return fmtDtShort(d)}),
        datasets:[{label:'g/week',data:weekKeys.map(k=>byWeek[k]),fill:true,borderColor:'#f59e0b',backgroundColor:'rgba(245,158,11,.12)',tension:.4,pointRadius:3,pointBackgroundColor:'#f59e0b'}]
      },
      options:{responsive:true,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed.y+'g'}}},scales:{y:{ticks:{callback:v=>v+'g'},grid:{color:'#f0ede8'}},x:{ticks:{font:{size:9},maxRotation:0},grid:{display:false}}}}
    });
  }

  // Per-batch totals with flush breakdown
  const max=byBatch[ids[0]].total;
  document.getElementById('harvest-totals').innerHTML=ids.map(id=>{
    const d=byBatch[id],pct=Math.round((d.total/max)*100);
    return`<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px"><span style="font-size:12px;font-weight:500">${spDot(d.species)}${esc(id)}</span><span style="font-size:13px;font-weight:600;color:var(--c-amber-dark)">${d.total}g</span></div><div class="harvest-bar"><div class="harvest-bar-fill" style="width:${pct}%"></div></div><div style="font-size:10px;color:var(--c-text-muted);margin-top:2px">${Object.entries(d.flushes).map(([f,g])=>`Flush ${f}: ${g}g`).join(' · ')}</div></div>`;
  }).join('');
}

// ─── TO-DO ───────────────────────────────────────────────────
function buildAutoTasks(){
  const tasks=[],today=new Date();today.setHours(0,0,0,0);
  batches.forEach(b=>{
    const{status,action}=getStatus(b.batchId);if(status==='DONE'||status==='EMPTY')return;
    const due=new Date(b.due);due.setHours(0,0,0,0);
    const dl=Math.round((due-today)/(864e5));
    let urgent=false,warn=false,text='',detail='';
    if(status==='INCUBATING'||status==='SPAWN RUN'){
      if(dl<0){urgent=true;text=`${b.batchId} \u2014 ${action}`;detail=t('todo.dueAgo',{n:Math.abs(dl)})}
      else if(dl<=2){warn=true;text=`${b.batchId} \u2014 ${action}`;detail=t('todo.dueIn',{n:dl})}
      else{text=`${b.batchId} \u2014 ${action}`;detail=t('todo.dueIn',{n:dl})}
    }else if(status==='FRUITING'){text=`${b.batchId} \u2014 ${t('status.action.harvest')}`;detail=`${b.species}/${b.strain} ${t('todo.fruiting')}`;warn=true}
    else if(status==='CONTAM'){text=`${b.batchId} \u2014 ${t('status.action.discard')}`;detail=`${b.species}/${b.strain}`;urgent=true}
    if(text)tasks.push({text,detail,urgent,warn,species:b.species});
  });
  return tasks;
}
function toggleTask(id){const t=manualTasks.find(x=>x.id===id);if(!t)return;t.done=!t.done;t.caldavSynced=null;apiPatch('/api/tasks/'+id,{done:t.done,caldavSynced:null});renderCalendar();updateTodoBadge();if(caldav.enabled&&t.caldavUid)pushTaskCaldav(t)}
function deleteTask(id){const t=manualTasks.find(x=>x.id===id);if(!t)return;confirm2('Delete task?','This task will be permanently removed.','Delete',()=>{manualTasks=manualTasks.filter(x=>x.id!==id);apiDelete('/api/tasks/'+id);renderCalendar();updateTodoBadge()})}
function updateTodoBadge(){const n=manualTasks.filter(t=>!t.done).length;const el=document.getElementById('n-cal');if(el)el.classList.toggle('alert',n>0);const bd=buildAutoTasks().filter(t=>t.urgent||t.warn).length+getInvAlerts().length;const de=document.getElementById('n-dash');if(de)de.classList.toggle('alert',bd>0)}

// ─── TEAM MEMBERS ───────────────────────────────────────────
function renderTeam(){
  const el=document.getElementById('team-list');
  if(typeof fillCalendarUserFilter==='function')fillCalendarUserFilter();
  if(!el)return;
  if(!teamMembers.length){el.innerHTML='<div class="empty" style="padding:1rem">No team members yet. Add your first member below.</div>';return}
  el.innerHTML=teamMembers.map(m=>`<div class="member-row"><span class="name">${esc(m.name)}</span>${m.role?`<span style="font-size:11px;color:var(--c-text-muted)">${esc(m.role)}</span>`:''}<button class="btn btn-sm btn-r" onclick="removeMember(${m.id})">×</button></div>`).join('');
}
function addMember(){
  const name=document.getElementById('member-name').value.trim();if(!name)return;
  const role=document.getElementById('member-role').value.trim();
  if(teamMembers.some(m=>m.name.toLowerCase()===name.toLowerCase()))return;
  const member={name,role:role||null,added:new Date().toISOString()};
  teamMembers.push(member);
  document.getElementById('member-name').value='';document.getElementById('member-role').value='';
  apiPost('/api/team',member).then(r=>{if(r&&r.id)member.id=r.id;renderTeam()});
}
function removeMember(id){const m=teamMembers.find(x=>x.id===id);if(!m)return;confirm2('Remove member?','Remove '+m.name+' from the team. Their existing task assignments remain.','Remove',()=>{teamMembers=teamMembers.filter(x=>x.id!==id);apiDelete('/api/team/'+id);renderTeam()})}

// ─── CalDAV SYNC ────────────────────────────────────────────
function loadCaldavSettings(){
  // Show the CalDAV URL for this server
  const url=location.protocol+'//'+location.hostname+':'+location.port+'/caldav/calendars/';
  document.getElementById('caldav-url-display').textContent=url;
  document.getElementById('caldav-enabled').checked=!!caldav.enabled;
}
function saveCaldavSettings(){
  caldav.enabled=document.getElementById('caldav-enabled').checked;
  apiPost('/api/caldav/config',caldav).then(r=>{
    if(r.error){showCaldavStatus(r.error,'var(--c-red-dark)')}
    else{showCaldavStatus(t('caldav.settingsSaved'),'var(--c-green-dark)')}
  });
}
function showCaldavStatus(msg,color){
  const el=document.getElementById('caldav-status');
  el.style.display='block';el.style.color=color||'#888';el.textContent=msg;
  setTimeout(()=>{el.style.display='none'},8000);
}
async function syncCaldavNow(){
  if(!caldav.enabled){showCaldavStatus('Enable sync first, then save settings.','#92400e');return}
  const btn=document.getElementById('caldav-sync-btn');btn.disabled=true;btn.textContent='Syncing...';
  showCaldavStatus('Writing tasks to calendar files...','#888');
  try{
    const r=await authFetch('/api/caldav/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({caldav,teamMembers,manualTasks})}).then(r=>r.json());
    if(r.error){showCaldavStatus('Sync failed: '+r.error,'var(--c-red-dark)')}
    else{
      showCaldavStatus(`Done! ${r.pushed} tasks written to calendar.${r.errors?' ('+r.errors+' errors)':''}  Calendar clients can now see them via CalDAV.`, r.errors?'var(--c-amber-dark)':'var(--c-green-dark)');
      // Selective refresh: only reload tasks to get updated caldavUid/caldavSynced
      // instead of loadData() which would overwrite ALL local state
      try{const td=await authFetch('/api/data').then(r=>r.json());if(td.manualTasks)manualTasks=td.manualTasks;if(td.calendarEvents)calendarEvents=td.calendarEvents}catch{}
      renderCalendar();
    }
  }catch(e){showCaldavStatus('Sync error: '+e.message,'var(--c-red-dark)')}
  finally{btn.disabled=false;btn.textContent='Sync all tasks now'}
}
async function pushTaskCaldav(task){
  if(!caldav.enabled)return;
  try{
    const r=await authFetch('/api/caldav/push-one',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({task})}).then(r=>r.json());
    if(r.ok&&r.uid){task.caldavUid=r.uid;task.caldavSynced=new Date().toISOString();apiPatch('/api/tasks/'+task.id,{caldavUid:task.caldavUid,caldavSynced:task.caldavSynced});renderCalendar()}
  }catch(e){console.error('CalDAV push error:',e)}
}

// ─── DUCKDNS ────────────────────────────────────────────────
async function loadDuckdnsSettings(){
  try{
    const r=await authFetch('/api/duckdns/config');
    if(!r.ok)return;
    const cfg=await r.json();
    document.getElementById('duckdns-enabled').checked=!!cfg.enabled;
    document.getElementById('duckdns-domain').value=cfg.domain||'';
    const tokenEl=document.getElementById('duckdns-token');
    tokenEl.value='';
    tokenEl.placeholder=cfg.hasToken?'••••••••••':'';
    document.getElementById('duckdns-le-enabled').checked=!!cfg.leEnabled;
  }catch(e){/* non-admin */}
  await refreshDuckdnsStatus();
}
async function refreshDuckdnsStatus(){
  try{
    const r=await authFetch('/api/duckdns/status');
    if(!r.ok)return;
    const s=await r.json();
    const banner=document.getElementById('duckdns-status-banner');
    if(s.enabled&&s.domain){
      banner.style.display='block';
      if(s.lastIp){
        banner.style.background='var(--c-primary-light)';banner.style.border='1px solid var(--c-green-border)';banner.style.color='var(--c-green-dark)';
        banner.innerHTML='<strong>'+s.domain+'</strong> &rarr; '+s.lastIp+(s.lastIpUpdate?' <span style="color:var(--c-text-muted)">('+fmtDtTime(s.lastIpUpdate)+')</span>':'');
      }else{
        banner.style.background='var(--c-amber-light)';banner.style.border='1px solid var(--c-amber-border)';banner.style.color='var(--c-amber-dark)';
        banner.textContent='DuckDNS aktiviert, aber noch kein IP-Update durchgeführt.';
      }
    }else{banner.style.display='none'}
    const certEl=document.getElementById('le-cert-status');
    if(s.cert&&s.cert.exists){
      certEl.style.display='block';
      if(s.cert.type==='letsencrypt'&&s.leExpiry){
        const daysLeft=Math.round((new Date(s.leExpiry)-Date.now())/86400000);
        const ok=daysLeft>30,warn=daysLeft>7;
        certEl.style.background=ok?'var(--c-primary-light)':warn?'var(--c-amber-light)':'var(--c-red-light)';
        certEl.style.border='1px solid '+(ok?'var(--c-green-border)':warn?'var(--c-amber-border)':'var(--c-red-border)');
        certEl.style.color=ok?'var(--c-green-dark)':warn?'var(--c-amber-dark)':'var(--c-red-dark)';
        certEl.innerHTML='Let\'s Encrypt Zertifikat aktiv. Ablauf: '+fmtDt(s.leExpiry)+' ('+daysLeft+' Tage)';
      }else{
        certEl.style.background='var(--c-blue-light)';certEl.style.border='1px solid var(--c-blue-border)';certEl.style.color='var(--c-blue-dark)';
        certEl.textContent='Aktuelles Zertifikat: '+s.cert.type;
      }
    }else{certEl.style.display='none'}
  }catch(e){/* non-admin */}
}
function showDuckdnsStatus(msg,color){
  const el=document.getElementById('duckdns-ip-status');
  el.style.display='block';el.style.color=color||'#888';el.textContent=msg;
  setTimeout(()=>{el.style.display='none'},8000);
}
function showLeStatus(msg,color){
  const el=document.getElementById('le-status');
  el.style.display='block';el.style.color=color||'#888';el.textContent=msg;
  setTimeout(()=>{el.style.display='none'},15000);
}
async function saveDuckdnsSettings(){
  const tokenVal=document.getElementById('duckdns-token').value.trim();
  const cfg={
    enabled:document.getElementById('duckdns-enabled').checked,
    domain:document.getElementById('duckdns-domain').value.trim().toLowerCase(),
    leEnabled:document.getElementById('duckdns-le-enabled').checked
  };
  if(tokenVal)cfg.token=tokenVal;
  if(cfg.enabled&&!cfg.domain){showDuckdnsStatus('Subdomain ist erforderlich.','var(--c-red-dark)');return}
  if(cfg.enabled&&!tokenVal&&!document.getElementById('duckdns-token').placeholder){showDuckdnsStatus('Token ist erforderlich.','var(--c-red-dark)');return}
  try{
    const r=await apiPost('/api/duckdns/config',cfg);
    if(r.error){showDuckdnsStatus('Fehler: '+r.error,'var(--c-red-dark)')}
    else{showDuckdnsStatus('Einstellungen gespeichert.','var(--c-green-dark)');refreshDuckdnsStatus()}
  }catch(e){showDuckdnsStatus('Fehler: '+e.message,'var(--c-red-dark)')}
}
async function triggerDuckdnsUpdate(){
  const btn=document.getElementById('duckdns-update-btn');
  btn.disabled=true;btn.textContent='Aktualisiere...';
  showDuckdnsStatus('Sende IP-Update an DuckDNS...','#888');
  try{
    const r=await authFetch('/api/duckdns/update-ip',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const data=await r.json();
    if(data.error){showDuckdnsStatus('Fehler: '+data.error,'var(--c-red-dark)')}
    else{showDuckdnsStatus('IP aktualisiert: '+data.lastIp,'var(--c-green-dark)');refreshDuckdnsStatus()}
  }catch(e){showDuckdnsStatus('Fehler: '+e.message,'var(--c-red-dark)')}
  finally{btn.disabled=false;btn.textContent='IP jetzt aktualisieren'}
}
async function requestLeCert(){
  const btn=document.getElementById('le-request-btn');
  btn.disabled=true;btn.textContent='Wird angefordert...';
  showLeStatus('Zertifikat wird bei Let\'s Encrypt angefordert (kann 1-2 Minuten dauern)...','#888');
  try{
    const r=await authFetch('/api/duckdns/request-cert',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const data=await r.json();
    if(data.error){showLeStatus('Fehler: '+data.error,'var(--c-red-dark)')}
    else{showLeStatus('Zertifikat ausgestellt für '+data.domain+'! Ablauf: '+fmtDt(data.expiry),'var(--c-green-dark)');refreshDuckdnsStatus()}
  }catch(e){showLeStatus('Fehler: '+e.message,'var(--c-red-dark)')}
  finally{btn.disabled=false;btn.textContent='Zertifikat jetzt anfordern'}
}

// ─── MCP TAB (admin-only) ───────────────────────────────────
function showMcpTab(){
  const btn=document.getElementById('st-settings-mcp');
  if(btn&&currentUser&&currentUser.role==='admin')btn.style.display='';
}

// ─── SERVER TAB ─────────────────────────────────────────────
function showServerTab(){
  const btn=document.getElementById('st-settings-server');
  if(btn&&currentUser&&currentUser.role==='admin')btn.style.display='';
}
async function loadServerTab(){
  const el=document.getElementById('server-info');
  if(!el)return;
  if(!currentUser||currentUser.role!=='admin'){el.textContent='Admin access required.';return}
  try{
    const r=await authFetch('/api/health');
    const h=await r.json();
    const uptimeH=Math.floor(h.uptime/3600);
    const uptimeM=Math.floor((h.uptime%3600)/60);
    const platLabel=h.platform==='win32'?'Windows':h.platform==='darwin'?'macOS':'Linux';
    el.innerHTML='<div><b>Status:</b> '+esc(h.status)+'</div>'+
      '<div><b>Version:</b> '+esc(h.version)+'</div>'+
      '<div><b>Plattform:</b> '+platLabel+'</div>'+
      '<div><b>Node.js:</b> '+esc(h.nodeVersion||'–')+'</div>'+
      '<div><b>Uptime:</b> '+uptimeH+'h '+uptimeM+'m</div>'+
      '<div><b>SSE Clients:</b> '+h.sseClients+'</div>'+
      (h.memory?'<div><b>RAM:</b> '+h.memory.rss+' MB</div>':'');
  }catch(e){el.textContent='Fehler beim Laden.'}
}
function restartServer(){
  confirm2('Server neustarten?','Der Code wird von GitHub aktualisiert und der Server neu gestartet. Alle Benutzer werden kurz getrennt.','Ja, neustarten',async()=>{
    const btn=document.getElementById('btn-server-restart');
    const status=document.getElementById('server-restart-status');
    btn.disabled=true;btn.textContent='Wird neugestartet...';
    status.style.display='block';status.style.color='var(--c-text-muted)';
    status.textContent='Server wird aktualisiert und neugestartet...';
    try{
      await authFetch('/api/server/restart',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      status.textContent='Server startet neu. Warte auf Verbindung...';
      let attempts=0;
      const poll=setInterval(async()=>{
        attempts++;
        try{
          const r=await fetch('/api/health');
          if(r.ok){clearInterval(poll);window.location.reload()}
        }catch(e){/* still down */}
        if(attempts>60){clearInterval(poll);status.textContent='Server antwortet nicht. Bitte manuell prüfen.';status.style.color='var(--c-red-dark)';btn.disabled=false;btn.textContent='Server aktualisieren & neustarten'}
      },3000);
    }catch(e){status.textContent='Fehler: '+e.message;status.style.color='var(--c-red-dark)';btn.disabled=false;btn.textContent='Server aktualisieren & neustarten'}
  });
}

// ─── MCP SETTINGS ───────────────────────────────────────────
let _mcpToken='';
async function loadMcpSettings(){
  try{
    const r=await authFetch('/api/mcp/config');
    if(!r.ok)return;
    const cfg=await r.json();
    document.getElementById('mcp-enabled').checked=cfg.enabled;
    document.getElementById('mcp-url').value=cfg.connectorUrl||'';
    toggleMcpSections(cfg.enabled);
    const banner=document.getElementById('mcp-status-banner');
    if(cfg.enabled){
      banner.style.display='block';banner.style.background='var(--c-primary-light)';banner.style.border='1px solid var(--c-green-border)';banner.style.color='var(--c-green-dark)';
      banner.textContent=t('mcp.active');
    }else{banner.style.display='none'}
    const statusR=await authFetch('/api/mcp/status');
    if(statusR.ok){
      const st=await statusR.json();
      if(st.activeSessions>0){
        banner.style.display='block';banner.style.background='var(--c-primary-light)';banner.style.border='1px solid var(--c-green-border)';banner.style.color='var(--c-green-dark)';
        banner.textContent=t('mcp.sessions').replace('{n}',st.activeSessions);
      }
    }
    if(cfg.enabled) loadOAuthClients();
  }catch(e){/* non-admin */}
}
function toggleMcpSections(enabled){
  document.getElementById('mcp-url-section').style.display=enabled?'block':'none';
  document.getElementById('mcp-token-section').style.display=enabled?'block':'none';
  document.getElementById('mcp-guide-card').style.display=enabled?'block':'none';
  document.getElementById('mcp-diag-card').style.display=enabled?'block':'none';
  document.getElementById('mcp-oauth-card').style.display=enabled?'block':'none';
}
function showMcpStatus(msg,color){
  const el=document.getElementById('mcp-status');
  el.style.display='block';el.style.color=color||'#888';el.textContent=msg;
  setTimeout(()=>{el.style.display='none'},8000);
}
async function saveMcpSettings(){
  try{
    const r=await apiPost('/api/mcp/config',{enabled:document.getElementById('mcp-enabled').checked});
    if(r.error){showMcpStatus(t('mcp.error').replace('{msg}',r.error),'var(--c-red-dark)')}
    else{showMcpStatus(t('mcp.saved'),'var(--c-green-dark)');loadMcpSettings()}
  }catch(e){showMcpStatus(t('mcp.error').replace('{msg}',e.message),'var(--c-red-dark)')}
}
async function generateMcpToken(){
  try{
    const r=await authFetch('/api/mcp/generate-token',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const data=await r.json();
    if(data.error){showMcpStatus(t('mcp.error').replace('{msg}',data.error),'var(--c-red-dark)');return}
    _mcpToken=data.token;
    document.getElementById('mcp-token-display').textContent=data.token;
    document.getElementById('mcp-token-display').style.display='block';
    document.getElementById('mcp-copy-token-btn').style.display='inline-flex';
    showMcpStatus(t('mcp.keyGenerated'),'var(--c-green-dark)');
  }catch(e){showMcpStatus(t('mcp.error').replace('{msg}',e.message),'var(--c-red-dark)')}
}

async function runMcpDiagnostics(){
  const el=document.getElementById('mcp-diag-result');
  el.innerHTML='<p style="color:var(--c-text-muted)">'+t('mcp.diagRunning')+'</p>';
  try{
    const r=await authFetch('/api/mcp/diagnostics');
    if(!r.ok){el.innerHTML='<p style="color:var(--c-red-dark)">'+t('mcp.diagFailed')+'</p>';return}
    const d=await r.json();
    let html='<table style="width:100%;font-size:12px;border-collapse:collapse">';
    const row=(label,val,color)=>'<tr><td style="padding:4px 8px;font-weight:600;white-space:nowrap;vertical-align:top">'+label+'</td><td style="padding:4px 8px;color:'+(color||'#333')+'">'+val+'</td></tr>';
    const checks=d.checks||{};
    for(const[k,v]of Object.entries(checks)){
      const pass=v.startsWith('PASS');
      html+=row(k,esc(v),pass?'var(--c-green-dark)':'var(--c-red-dark)');
    }
    html+=row('Protocol',esc(d.protocol));
    html+=row('Base URL','<code style="font-size:11px;background:#f1f5f9;padding:1px 4px;border-radius:3px">'+esc(d.connectorUrl)+'</code>');
    html+=row(t('mcp.diagAutoClients'),String(d.oauthClients?.auto||0));
    html+=row(t('mcp.diagManualClients'),String(d.oauthClients?.manual||0));
    html+=row(t('mcp.diagSessions'),String(d.activeSessions||0));
    html+='</table>';
    if(d.hint)html+='<div style="margin-top:8px;padding:8px 10px;border-radius:6px;font-size:11px;background:var(--c-primary-light);border:1px solid var(--c-green-border);color:var(--c-green-dark)">'+esc(d.hint)+'</div>';
    el.innerHTML=html;
  }catch(e){el.innerHTML='<p style="color:var(--c-red-dark)">Error: '+esc(e.message)+'</p>'}
}

// ─── OAUTH CLIENT MANAGEMENT ────────────────────────────────
function showOAuthStatus(msg,color){
  const el=document.getElementById('oauth-client-status');
  el.style.display='block';el.style.color=color||'#888';el.textContent=msg;
  setTimeout(()=>{el.style.display='none'},8000);
}
async function loadOAuthClients(){
  try{
    const r=await authFetch('/api/mcp/oauth-clients');
    if(!r.ok)return;
    const data=await r.json();
    const list=document.getElementById('oauth-client-list');
    if(!list)return;
    if(!data.clients||data.clients.length===0){
      list.innerHTML='<p style="color:var(--c-text-muted);font-size:12px">'+t('mcp.noClients')+'</p>';
      return;
    }
    list.innerHTML='<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr>'+
      '<th style="text-align:left;padding:6px;border-bottom:1px solid var(--c-border)">'+t('mcp.clientName')+'</th>'+
      '<th style="text-align:left;padding:6px;border-bottom:1px solid var(--c-border)">Client ID</th>'+
      '<th style="text-align:left;padding:6px;border-bottom:1px solid var(--c-border)">'+t('mcp.created')+'</th>'+
      '<th style="text-align:left;padding:6px;border-bottom:1px solid var(--c-border)">'+t('mcp.activeSessions')+'</th>'+
      '<th style="padding:6px;border-bottom:1px solid var(--c-border)"></th></tr></thead><tbody>'+
      data.clients.map(c=>{
        const name=c.clientName||t('mcp.unnamed');
        return '<tr>'+
          '<td style="padding:6px">'+esc(name)+'</td>'+
          '<td style="padding:6px;font-family:monospace">'+esc(c.clientId.slice(0,8))+'…</td>'+
          '<td style="padding:6px">'+esc(c.created?c.created.slice(0,10):'')+'</td>'+
          '<td style="padding:6px;text-align:center">'+c.activeSessions+'</td>'+
          '<td style="padding:6px"><button class="btn btn-sm" style="font-size:11px;padding:2px 8px;color:var(--c-red-dark)" data-oauth-action="delete" data-client-id="'+esc(c.clientId)+'" data-auto="'+(c.autoRegistered?1:0)+'">'+t('mcp.deleteClient')+'</button></td></tr>';
      }).join('')+
      '</tbody></table>';
    list.onclick=function(e){
      const btn=e.target.closest('[data-oauth-action="delete"]');
      if(!btn)return;
      deleteOAuthClient(btn.dataset.clientId,btn.dataset.auto==='1');
    };
  }catch(e){console.error('loadOAuthClients:',e)}
}
async function deleteOAuthClient(clientId,isAuto){
  if(!confirm(isAuto?t('mcp.confirmDeleteAuto'):t('mcp.confirmDelete')))return;
  try{
    const r=await authFetch('/api/mcp/oauth-clients/'+encodeURIComponent(clientId),{method:'DELETE'});
    const data=await r.json();
    if(data.error){showOAuthStatus(t('mcp.error').replace('{msg}',data.error),'var(--c-red-dark)');return}
    showOAuthStatus(t('mcp.clientDeleted'),'var(--c-green-dark)');
    loadOAuthClients();
  }catch(e){showOAuthStatus(t('mcp.error').replace('{msg}',e.message),'var(--c-red-dark)')}
}

// ─── SCAN LOG ────────────────────────────────────────────────
let logSortCol='time',logSortDir='desc',logDisplayLimit=200;
function toggleLogSort(col){if(logSortCol===col)logSortDir=logSortDir==='desc'?'asc':'desc';else{logSortCol=col;logSortDir='desc'}renderLog()}
function renderLog(){
  const q=(document.getElementById('log-q').value||'').toLowerCase();
  const actionF=document.getElementById('log-action-filter').value;
  const dateFrom=document.getElementById('log-date-from').value;
  const dateTo=document.getElementById('log-date-to').value;
  const body=document.getElementById('log-body');
  let items=[...scanLog];
  // Filters
  if(q)items=items.filter(e=>JSON.stringify(e).toLowerCase().includes(q));
  if(actionF)items=items.filter(e=>e.action===actionF);
  if(dateFrom)items=items.filter(e=>e.time>=dateFrom);
  if(dateTo)items=items.filter(e=>e.time<dateTo+'T23:59:59');
  // Sort
  const dir=logSortDir==='desc'?-1:1;
  items.sort((a,b)=>{const av=a[logSortCol]||'',bv=b[logSortCol]||'';return av<bv?-dir:av>bv?dir:0});
  // Sort indicators
  document.querySelectorAll('[id^="log-sort-"]').forEach(el=>el.textContent='');
  const si=document.getElementById('log-sort-'+logSortCol);if(si)si.textContent=logSortDir==='desc'?'▼':'▲';
  // Count display
  const total=scanLog.length,filtered=items.length;
  const countEl=document.getElementById('log-count');
  if(countEl)countEl.textContent=filtered===total?total+' Einträge':filtered+' von '+total+' Einträgen';
  // Paginate
  const hasMore=items.length>logDisplayLimit;
  items=items.slice(0,logDisplayLimit);
  const now=Date.now(),h24=24*60*60*1000;
  body.innerHTML=items.length?items.map(e=>{
    const isRecent=(now-new Date(e.time).getTime())<h24;
    return `<tr><td style="font-size:10px;color:var(--c-text-muted)">${fmtDtTime(e.time)}</td><td style="font-size:11px">${esc(e.user)||'\u2014'}</td><td><span class="badge ${e.action==='ADD'?'b-add':e.action==='REMOVE'?'b-remove':e.action==='HARVEST'?'b-harvest':'b-move'}">${esc(e.action)}</span></td><td style="font-family:monospace;font-size:10px">${esc(e.batch)||'\u2014'}</td><td style="font-family:monospace;font-size:10px">${esc(e.bag)||'\u2014'}</td><td>${esc(e.from)||'\u2014'}</td><td>${esc(e.to)||'\u2014'}</td><td>${e.species?spDot(e.species)+esc(e.species):'\u2014'}</td><td>${isRecent?'<button class="btn-xs" style="padding:2px 6px;font-size:10px" onclick="deleteLogEntry(this,\''+esc(e.time)+'\',\''+esc(e.batch)+'\',\''+esc(e.action)+'\')" title="Löschen">✕</button>':''}</td></tr>`}).join(''):'<tr><td colspan="9" class="empty">'+t('settings.noScans')+'</td></tr>';
  const loadMore=document.getElementById('log-load-more');if(loadMore)loadMore.style.display=hasMore?'block':'none';
}
function deleteLogEntry(btn,time,batch,action){
  confirm2('Eintrag löschen?',action+' '+batch+' vom '+fmtDtTime(time)+' löschen?','Löschen',()=>{
    const idx=scanLog.findIndex(e=>e.time===time&&e.batch===batch&&e.action===action);
    if(idx===-1)return;
    const entry=scanLog[idx];
    scanLog.splice(idx,1);
    const mi=movements.findIndex(e=>e.time===time&&e.batch===batch&&e.action===action);
    if(mi!==-1)movements.splice(mi,1);
    const serverId=entry._serverId||entry.id;
    if(serverId)apiDelete('/api/scan-log/'+serverId);
    renderLog();renderStatus();
  });
}
function clearLog(){confirm2(t('settings.clearLog'),t('settings.clearLogMsg',{n:scanLog.length}),t('settings.clearLogBtn'),async()=>{await apiDelete('/api/scan-log');scanLog=[];renderLog()})}

// ─── INVENTORY ───────────────────────────────────────────────
const MAT_LABELS={hardwood:'Hardwood pellets',wheatbran:'Wheat bran',gypsum:'Gypsum',grain:'Grain'};
const MAT_COLORS={hardwood:'#92400e',wheatbran:'#166534',gypsum:'#1e40af',grain:'#6b21a8'};
const MAT_BG={hardwood:'#fff7ed',wheatbran:'#f0fdf4',gypsum:'#eff6ff',grain:'#faf5ff'};
const MAT_BORDER={hardwood:'#fed7aa',wheatbran:'#bbf7d0',gypsum:'#bfdbfe',grain:'#e9d5ff'};

function invLog(mat,deltaKg,type,ref,time){
  if(!inventory.log)inventory.log=[];
  const running=inventory.stock[mat]||0;
  inventory.log.push({time:time||new Date().toISOString(),mat,deltaKg,running,type,ref});
}

function getAvgComp(){
  // Returns the average composition settings, with fallback defaults
  const a=inventory.avgComposition||{};
  return{
    hwPct:a.hwPct??75,
    wbPct:a.wbPct??25,
    rhPct:a.rhPct??63,
    bagKg:a.bagKg??3,
    grainBagKg:a.grainBagKg??1
  };
}

function estBagsFromMat(mat,stockKg){
  // Estimate how many fruiting blocks (or grain bags) can be made from this material
  // For HW/WB: dry matter per bag = bagKg × (1 − rh/100), split by avg %
  // For grain: simply stockKg / grainBagKg
  const c=getAvgComp();
  if(mat==='grain'){
    return{bags:c.grainBagKg>0?Math.floor(stockKg/c.grainBagKg):0,bagKg:c.grainBagKg,isGrain:true};
  }
  const dryPerBag=c.bagKg*(1-c.rhPct/100);  // dry matter per bag
  let matPerBag=0;
  if(mat==='hardwood') matPerBag=dryPerBag*(c.hwPct/100);
  if(mat==='wheatbran') matPerBag=dryPerBag*(c.wbPct/100);
  if(mat==='gypsum') matPerBag=dryPerBag*0.01;
  const bags=matPerBag>0?Math.floor(stockKg/matPerBag):0;
  return{bags,matPerBag,bagKg:c.bagKg,isGrain:false};
}

function renderInvStock(){
  if(!inventory.stock)inventory.stock={hardwood:0,wheatbran:0,gypsum:0,grain:0};
  if(!inventory.thresholds)inventory.thresholds={hardwood:{minKg:50},wheatbran:{minKg:20},gypsum:{minKg:5},grain:{minKg:10}};
  if(!inventory.avgComposition)inventory.avgComposition={hwPct:75,wbPct:25,rhPct:63,bagKg:3,grainBagKg:1};

  const cards=document.getElementById('inv-cards');
  cards.innerHTML=Object.keys(MAT_LABELS).map(mat=>{
    const stock=inventory.stock[mat]||0;
    const thresh=inventory.thresholds[mat]||{minKg:0};
    const low=thresh.minKg>0&&stock<thresh.minKg;
    const {bags,bagKg,matPerBag,isGrain}=estBagsFromMat(mat,stock);
    const pct=thresh.minKg>0?Math.min(100,Math.round((stock/Math.max(stock,thresh.minKg*3))*100)):Math.min(100,Math.round((stock/Math.max(stock,100))*100));
    const estNote=isGrain
      ? `≈ ${bags} grain bags @ ${bagKg}kg each`
      : `≈ <strong>${bags}</strong> × ${bagKg}kg blocks <span style="font-size:10px;color:var(--c-text-muted)">(avg estimate)</span>`;
    return`<div style="background:${MAT_BG[mat]};border:1px solid ${low?'var(--c-red)':MAT_BORDER[mat]};border-radius:10px;padding:14px 16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div style="font-size:12px;font-weight:600;color:${MAT_COLORS[mat]}">${MAT_LABELS[mat]}</div>
        ${low?`<span style="font-size:10px;background:var(--c-red-light);color:var(--c-red-dark);padding:2px 7px;border-radius:99px;font-weight:600">LOW STOCK</span>`:''}
      </div>
      <div style="font-size:26px;font-weight:700;color:var(--c-text);margin-bottom:2px">${stock.toFixed(1)} <span style="font-size:14px;font-weight:400;color:var(--c-text-muted)">kg</span></div>
      <div style="height:5px;border-radius:3px;background:rgba(0,0,0,.08);overflow:hidden;margin-bottom:8px">
        <div style="height:100%;border-radius:3px;background:${low?'var(--c-red)':MAT_COLORS[mat]};width:${pct}%;transition:width .3s"></div>
      </div>
      <div style="font-size:12px;color:var(--c-text-sec);line-height:1.6">${estNote}</div>
      ${thresh.minKg>0?`<div style="font-size:11px;color:${low?'var(--c-red-dark)':'var(--c-text-muted)'};margin-top:2px">Alert below ${thresh.minKg}kg</div>`:''}
      <button class="btn btn-sm" onclick="openStab('inv','delivery')" style="margin-top:8px;font-size:11px">+ Log delivery</button>
      ${(()=>{const sups=getSuppliersForMat(mat);if(!sups.length)return'';
        return`<div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(0,0,0,.06);font-size:11px;color:var(--c-text-sec)">
          <span style="font-weight:600;color:${low?'var(--c-red-dark)':'var(--c-text-muted)'}">${low?t('inv.reorderFrom'):t('inv.suppliers')}:</span>
          ${sups.map(s=>s.url?`<a href="${esc(s.url)}" target="_blank" rel="noopener" style="color:var(--c-blue);margin-left:4px">${esc(s.name)}</a>`:`<span style="margin-left:4px">${esc(s.name)}</span>`).join(',')}
        </div>`;})()}
    </div>`;
  }).join('');
  renderThresholds();
}

function renderThresholds(){
  const el=document.getElementById('inv-thresholds');
  if(!el)return;
  const c=getAvgComp();

  // Per-material alert thresholds
  const threshHtml=`<div style="overflow-x:auto;margin-bottom:16px"><table>
    <thead><tr><th>Material</th><th>In stock</th><th>Alert below (kg)</th><th>Est. bags (avg)</th></tr></thead>
    <tbody>
    ${Object.keys(MAT_LABELS).map(mat=>{
      const stock=inventory.stock[mat]||0;
      const t=inventory.thresholds[mat]||{minKg:0};
      const {bags}=estBagsFromMat(mat,stock);
      return`<tr>
        <td style="font-weight:500;color:${MAT_COLORS[mat]}">${MAT_LABELS[mat]}</td>
        <td style="font-weight:600">${stock.toFixed(2)} kg</td>
        <td><input type="text" inputmode="decimal" value="${esc(t.minKg)}" style="width:80px;font-size:12px;padding:3px 6px" onchange="updateThreshold('${mat}','minKg',this.value)" /></td>
        <td style="font-size:12px;color:var(--c-text-sec)">~${bags} bags <span style="font-size:10px;color:var(--c-text-muted)">(avg)</span></td>
      </tr>`;
    }).join('')}
    </tbody>
  </table></div>`;

  // Average composition settings
  const compHtml=`<div style="background:var(--c-bg);border-radius:8px;padding:12px">
    <div style="font-size:11px;font-weight:600;color:var(--c-text-muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px">
      Average composition used for estimates
    </div>
    <p style="font-size:12px;color:var(--c-text-muted);margin-bottom:10px;line-height:1.6">
      These averages are used to calculate "~X bags" on the stock cards. 
      They are <strong>estimates only</strong> — exact usage is tracked when you create a batch with a specific substrate recipe.
    </p>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">
      <div><label style="font-size:11px">Hardwood %</label>
        <input type="text" inputmode="decimal" value="${esc(c.hwPct)}" style="font-size:13px;padding:5px 8px" onchange="updateAvgComp('hwPct',this.value)" /></div>
      <div><label style="font-size:11px">Wheat bran %</label>
        <input type="text" inputmode="decimal" value="${esc(c.wbPct)}" style="font-size:13px;padding:5px 8px" onchange="updateAvgComp('wbPct',this.value)" /></div>
      <div><label style="font-size:11px">Water % (RH)</label>
        <input type="text" inputmode="decimal" value="${esc(c.rhPct)}" style="font-size:13px;padding:5px 8px" onchange="updateAvgComp('rhPct',this.value)" /></div>
      <div><label style="font-size:11px">Block weight (kg)</label>
        <input type="text" inputmode="decimal" value="${esc(c.bagKg)}" style="font-size:13px;padding:5px 8px" onchange="updateAvgComp('bagKg',this.value)" /></div>
      <div><label style="font-size:11px">Grain bag (kg)</label>
        <input type="text" inputmode="decimal" value="${esc(c.grainBagKg)}" style="font-size:13px;padding:5px 8px" onchange="updateAvgComp('grainBagKg',this.value)" /></div>
    </div>
    <div style="margin-top:8px;font-size:11px;color:var(--c-text-muted)">
      With these settings: 1 × ${c.bagKg}kg block uses ~${(c.bagKg*(1-c.rhPct/100)*(c.hwPct/100)).toFixed(3)}kg hardwood + ~${(c.bagKg*(1-c.rhPct/100)*(c.wbPct/100)).toFixed(3)}kg wheat bran (dry weights after removing ${c.rhPct}% water)
    </div>
  </div>`;

  el.innerHTML=threshHtml+compHtml;
}

function updateAvgComp(key,val){
  if(!inventory.avgComposition)inventory.avgComposition={hwPct:75,wbPct:25,rhPct:63,bagKg:3,grainBagKg:1};
  inventory.avgComposition[key]=parseFloat(val)||0;
  saveInvConfig();renderInvStock();
}

function updateThreshold(mat,key,val){
  if(!inventory.thresholds)inventory.thresholds={};
  if(!inventory.thresholds[mat])inventory.thresholds[mat]={minKg:0};
  inventory.thresholds[mat][key]=parseFloat(val)||0;
  saveInvConfig();renderInvStock();
}

function delMatChange(){
  const mat=document.getElementById('del-mat').value;
  const stock=inventory.stock?.[mat]||0;
  document.getElementById('del-current').textContent='Current stock: '+stock.toFixed(2)+' kg';
  document.getElementById('del-kg').value='';
  document.getElementById('del-preview').style.display='none';
}
function delPreview(){
  const mat=document.getElementById('del-mat').value;
  const kg=parseFloat(document.getElementById('del-kg').value)||0;
  const el=document.getElementById('del-preview');
  if(!kg){el.style.display='none';return}
  const cur=inventory.stock?.[mat]||0;
  el.innerHTML='After delivery: <strong>'+(cur+kg).toFixed(2)+' kg</strong> ('+cur.toFixed(2)+' + '+kg+' kg)';
  el.style.display='block';
}
function adjMatChange(){
  const mat=document.getElementById('adj-mat').value;
  const stock=inventory.stock?.[mat]||0;
  document.getElementById('adj-current').textContent='Current stock: '+stock.toFixed(2)+' kg';
  document.getElementById('adj-absolute').value='';
  document.getElementById('adj-delta').value='';
  document.getElementById('adj-preview').style.display='none';
}
function adjPreview(mode){
  const mat=document.getElementById('adj-mat').value;
  const cur=inventory.stock?.[mat]||0;
  const el=document.getElementById('adj-preview');
  let newVal,diff;
  if(mode==='absolute'){
    const abs=parseFloat(document.getElementById('adj-absolute').value);
    if(isNaN(abs)){el.style.display='none';return}
    document.getElementById('adj-delta').value='';
    newVal=Math.max(0,abs);diff=newVal-cur;
    el.innerHTML='Set to <strong>'+newVal.toFixed(2)+' kg</strong> ('+(diff>=0?'+':'')+diff.toFixed(2)+' kg from current '+cur.toFixed(2)+' kg)';
  }else{
    const delta=parseFloat(document.getElementById('adj-delta').value);
    if(isNaN(delta)){el.style.display='none';return}
    document.getElementById('adj-absolute').value='';
    newVal=Math.max(0,cur+delta);diff=delta;
    el.innerHTML='New total: <strong>'+newVal.toFixed(2)+' kg</strong> ('+(diff>=0?'+':'')+diff.toFixed(2)+' kg)';
  }
  el.style.display='block';
}
function logDelivery(){
  const mat=document.getElementById('del-mat').value;
  const kg=parseFloat(document.getElementById('del-kg').value)||0;
  const note=document.getElementById('del-note').value.trim();
  if(kg<=0){alert('Enter a quantity greater than 0');return}
  if(!inventory.stock)inventory.stock={hardwood:0,wheatbran:0,gypsum:0,grain:0};
  inventory.stock[mat]=(inventory.stock[mat]||0)+kg;
  invDelta(mat,kg,'delivery',note||'delivery');
  document.getElementById('del-kg').value='';document.getElementById('del-note').value='';
  document.getElementById('del-preview').style.display='none';
  openStab('inv','stock');renderInvStock();
  setFb('ok','Delivery logged: +'+kg+'kg '+MAT_LABELS[mat]+' now '+inventory.stock[mat].toFixed(2)+'kg total');
}
function logAdjustment(){
  const mat=document.getElementById('adj-mat').value;
  const absVal=document.getElementById('adj-absolute').value;
  const deltaVal=document.getElementById('adj-delta').value;
  const reason=document.getElementById('adj-reason').value.trim()||'Manual adjustment';
  if(!inventory.stock)inventory.stock={hardwood:0,wheatbran:0,gypsum:0,grain:0};
  const cur=inventory.stock[mat]||0;
  let newStock,delta;
  if(absVal!==''){
    newStock=Math.max(0,parseFloat(absVal)||0);delta=newStock-cur;
  }else if(deltaVal!==''){
    delta=parseFloat(deltaVal)||0;newStock=Math.max(0,cur+delta);
  }else{alert('Enter either a new total or an adjustment amount');return}
  inventory.stock[mat]=newStock;
  invSetAbsolute(mat,newStock,'adjustment',reason);
  document.getElementById('adj-absolute').value='';document.getElementById('adj-delta').value='';
  document.getElementById('adj-reason').value='';document.getElementById('adj-preview').style.display='none';
  openStab('inv','stock');renderInvStock();
  setFb('ok','Adjusted '+MAT_LABELS[mat]+': '+(delta>=0?'+':'')+delta.toFixed(2)+'kg now '+newStock.toFixed(2)+'kg');
}

function renderInvLog(){
  const filter=document.getElementById('inv-log-filter').value;
  const body=document.getElementById('inv-log-body');
  if(!inventory.log||!inventory.log.length){body.innerHTML='<tr><td colspan="6" class="empty">No usage history yet.</td></tr>';return}
  const rows=[...inventory.log].reverse().filter(e=>filter==='all'||e.mat===filter).slice(0,200);
  // Build running totals per material going forwards for display
  body.innerHTML=rows.map(e=>`<tr>
    <td style="font-size:10px;color:var(--c-text-muted)">${fmtDtTime(e.time)}</td>
    <td style="color:${MAT_COLORS[e.mat]};font-weight:500">${MAT_LABELS[e.mat]}</td>
    <td style="font-weight:600;color:${e.deltaKg<0?'var(--c-red-dark)':'var(--c-green-dark)'}">${e.deltaKg>0?'+':''}${e.deltaKg.toFixed(2)} kg</td>
    <td style="font-size:11px">${(e.running||0).toFixed(1)} kg</td>
    <td><span class="badge ${e.type==='delivery'?'b-add':e.type==='adjustment'?'b-move':'b-harvest'}">${e.type}</span></td>
    <td style="font-size:11px;color:var(--c-text-sec)">${esc(e.ref)||'—'}</td>
  </tr>`).join('');
}

// Show low-stock alerts in dashboard
function getInvAlerts(){
  if(!inventory.stock||!inventory.thresholds)return[];
  return Object.keys(MAT_LABELS).filter(mat=>{
    const stock=inventory.stock[mat]||0;
    const thresh=(inventory.thresholds[mat]||{}).minKg||0;
    return thresh>0&&stock<thresh;
  }).map(mat=>{
    const stock=inventory.stock[mat]||0;
    const thresh=inventory.thresholds[mat].minKg;
    const {bags}=estBagsFromMat(mat,stock);
    const sups=getSuppliersForMat(mat);
    const supNote=sups.length?` — ${t('inv.reorderFrom')}: ${sups.map(s=>s.name).join(', ')}`:'';
    return{text:`Low stock: ${MAT_LABELS[mat]}`,detail:`${stock.toFixed(1)} kg remaining (≈${bags} bags) — below ${thresh}kg threshold${supNote}`,urgent:stock<thresh*0.5,warn:true,species:null};
  });
}

// ─── SUPPLIERS ───────────────────────────────────────────────
function renderSuppliers(){
  const el=document.getElementById('suppliers-list');
  if(!el)return;
  if(!suppliers.length){el.innerHTML=`<p style="color:var(--c-text-muted);font-size:13px">${t('inv.noSuppliers')}</p>`;return}
  const grouped={};
  Object.keys(MAT_LABELS).forEach(m=>grouped[m]=[]);
  suppliers.forEach(s=>{if(grouped[s.mat])grouped[s.mat].push(s)});
  el.innerHTML=Object.keys(MAT_LABELS).map(mat=>{
    const list=grouped[mat];
    if(!list.length)return'';
    return`<div style="margin-bottom:16px">
      <div style="font-size:12px;font-weight:600;color:${MAT_COLORS[mat]};margin-bottom:6px">${MAT_LABELS[mat]}</div>
      <div style="overflow-x:auto"><table>
        <thead><tr><th>${t('inv.supplierName')}</th><th>${t('inv.supplierUrl')}</th><th>${t('inv.supplierPhone')}</th><th>${t('inv.supplierNotes')}</th><th></th></tr></thead>
        <tbody>${list.map(s=>`<tr>
          <td style="font-weight:500">${esc(s.name)}</td>
          <td>${s.url?`<a href="${esc(s.url)}" target="_blank" rel="noopener" style="color:var(--c-blue);font-size:12px">${esc(s.url)}</a>`:'-'}</td>
          <td style="font-size:12px">${s.phone?esc(s.phone):'-'}</td>
          <td style="font-size:12px;color:var(--c-text-sec)">${s.notes?esc(s.notes):'-'}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm" onclick="editSupplier(${s.id})" style="font-size:11px">${t('inv.editSupplier')}</button>
            <button class="btn btn-sm" onclick="removeSupplier(${s.id})" style="font-size:11px;color:var(--c-red-dark)">${t('inv.deleteSupplier')}</button>
          </td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  }).join('');
}

function editSupplier(id){
  const existing=id?suppliers.find(s=>s.id===id):null;
  const matOpts=Object.keys(MAT_LABELS).map(m=>`<option value="${m}"${existing&&existing.mat===m?' selected':''}>${MAT_LABELS[m]}</option>`).join('');
  const html=`<div style="display:flex;flex-direction:column;gap:10px">
    <div><label>${t('inv.material')}</label><select id="sup-mat">${matOpts}</select></div>
    <div><label>${t('inv.supplierName')}</label><input type="text" id="sup-name" value="${existing?esc(existing.name):''}" placeholder="e.g. Agrobs GmbH" /></div>
    <div><label>${t('inv.supplierUrl')}</label><input type="text" id="sup-url" value="${existing&&existing.url?esc(existing.url):''}" placeholder="https://..." /></div>
    <div><label>${t('inv.supplierPhone')}</label><input type="text" id="sup-phone" value="${existing&&existing.phone?esc(existing.phone):''}" placeholder="+49..." /></div>
    <div><label>${t('inv.supplierNotes')}</label><input type="text" id="sup-notes" value="${existing&&existing.notes?esc(existing.notes):''}" placeholder="e.g. order number, contact person" /></div>
  </div>`;
  document.getElementById('m-title').textContent=existing?t('inv.editSupplier'):t('inv.addSupplier');
  document.getElementById('m-body').innerHTML=html;
  document.getElementById('m-ok').textContent=existing?t('inv.editSupplier'):t('inv.addSupplier');
  confirmCb=async()=>{
    const s={mat:document.getElementById('sup-mat').value,name:document.getElementById('sup-name').value.trim(),url:document.getElementById('sup-url').value.trim(),phone:document.getElementById('sup-phone').value.trim(),notes:document.getElementById('sup-notes').value.trim()};
    if(!s.name){alert('Name is required');return}
    if(existing)s.id=existing.id;
    const r=await apiPost('/api/suppliers',s);
    if(r&&r.id&&!existing){s.id=r.id;suppliers.push(s)}
    else if(existing){Object.assign(existing,s)}
    renderSuppliers();renderInvStock();
    setFb('ok',t('inv.supplierSaved'));
  };
  document.getElementById('m-confirm').classList.add('open');
}

async function removeSupplier(id){
  const s=suppliers.find(x=>x.id===id);
  if(!s)return;
  confirm2(t('inv.deleteSupplier'),'Remove '+s.name+' ('+MAT_LABELS[s.mat]+')?',t('inv.deleteSupplier'),async()=>{
    await apiDelete('/api/suppliers/'+id);
    suppliers=suppliers.filter(x=>x.id!==id);
    renderSuppliers();renderInvStock();
    setFb('ok',t('inv.supplierDeleted'));
  });
}

function getSuppliersForMat(mat){
  return suppliers.filter(s=>s.mat===mat);
}

// ─── BACKUP ──────────────────────────────────────────────────
function setStatus(el,msg,ok){el.style.color=ok?'var(--c-green-dark)':'var(--c-red-dark)';el.textContent=msg}
async function downloadBackup(){
  const pw=document.getElementById('backup-dl-pw').value;
  const st=document.getElementById('backup-dl-status');
  if(!pw||pw.length<8){setStatus(st,'Password must be at least 8 characters.',false);return}
  setStatus(st,'Preparing backup…',true);
  try{
    const r=await authFetch('/api/backup/download',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw})});
    if(!r.ok){const e=await r.json().catch(()=>({}));setStatus(st,e.error||'Download failed',false);return}
    const blob=await r.blob();
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    const cd=r.headers.get('content-disposition')||'';
    const m=cd.match(/filename="(.+?)"/);
    a.download=m?m[1]:'meisterpilze_backup.enc';
    a.click();URL.revokeObjectURL(a.href);
    setStatus(st,'Backup downloaded.',true);
    document.getElementById('backup-dl-pw').value='';
  }catch(err){setStatus(st,'Download failed',false)}
}
function restoreBackup(){
  const file=document.getElementById('restore-file').files[0];
  const pw=document.getElementById('backup-restore-pw').value;
  const st=document.getElementById('backup-restore-status');
  if(!file){setStatus(st,'Select a .enc backup file.',false);return}
  if(!pw){setStatus(st,'Enter the decryption password.',false);return}
  confirm2(t('settings.restoreBackup')||'Restore this backup?',t('settings.restoreMsg')||'Replaces ALL data on the server for all users. Cannot be undone.',t('settings.restoreConfirm')||'Yes, restore',async()=>{
    setStatus(st,'Restoring…',true);
    try{
      const buf=await file.arrayBuffer();
      const r=await authFetch('/api/backup/restore',{method:'POST',headers:{'Content-Type':'application/octet-stream','x-backup-password':pw},body:buf});
      if(!r.ok){const e=await r.json().catch(()=>({}));setStatus(st,e.error||'Restore failed',false);return}
      setStatus(st,'Restored successfully. Reloading…',true);
      document.getElementById('backup-restore-pw').value='';
      setTimeout(()=>window.location.reload(),1500);
    }catch(err){setStatus(st,'Restore failed',false)}
  });
}

// ─── ZONES (Location Management) ────────────────────────────
const ROLE_LABELS={spawn:'zones.roleSpawn',incubation:'zones.roleIncubation',fruiting:'zones.roleFruiting',contaminated:'zones.roleContaminated'};
const ROLE_ORDER=['spawn','incubation','fruiting','contaminated'];
function renderZones(){
  const el=document.getElementById('zones-list');
  if(!el)return;
  if(!zones.length){el.innerHTML='<div class="empty">'+esc(t('zones.empty'))+'</div>';return}
  // Group zones by role in canonical order; unknown roles go last.
  const groups={};
  ROLE_ORDER.forEach(r=>{groups[r]=[]});
  const extraRoles=[];
  zones.forEach(z=>{
    if(groups[z.role])groups[z.role].push(z);
    else{
      if(!groups[z.role]){groups[z.role]=[];extraRoles.push(z.role)}
      groups[z.role].push(z);
    }
  });
  // Within each group: sort by sortOrder (fallback to name for stability).
  Object.keys(groups).forEach(role=>{
    groups[role].sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0)||a.name.localeCompare(b.name));
  });
  const renderZone=z=>{
    const zoneBags=getZoneBags(z.id);
    const bagCount=Object.keys(zoneBags).length;
    const rackIds=new Set(z.racks.map(r=>r.id));
    const directCount=Object.values(zoneBags).filter(b=>!rackIds.has(b.loc)).length;
    const rackHtml=z.racks.length
      ?z.racks.map(r=>{
        const rBags=Object.keys(getRackBags(r.id)).length;
        return`<span class="zone-rack-chip">${esc(r.id)} <span style="color:var(--c-text-muted)">(${rBags})</span>${rBags===0?`<button class="btn btn-sm btn-r zone-rack-del" data-action="del-rack" data-rack="${esc(r.id)}" title="${esc(t('zones.delete'))}">&times;</button>`:''}</span>`;
      }).join('')
      :'<span style="color:var(--c-text-muted);font-size:11px">'+t('zones.noRacks')+'</span>';
    return`<div class="zone-row" data-zone-id="${esc(z.id)}" data-zone-role="${esc(z.role)}" style="border-left:4px solid ${safeColor(z.color)}">
      <div class="zone-row-header">
        <span class="zone-drag-handle" draggable="true" title="${esc(t('zones.dragToReorder'))}" aria-label="${esc(t('zones.dragToReorder'))}">\u22ee\u22ee</span>
        <span class="zone-row-name">${esc(z.name)}</span>
        <span class="badge">${esc(t(ROLE_LABELS[z.role])||z.role)}</span>
        <span style="font-size:11px;color:var(--c-text-muted)">${z.maxCapacity?bagCount+' / '+z.maxCapacity+' Bags':tp('dash.bags',bagCount)}</span>
        ${directCount>0?`<span class="badge zone-direct-badge" title="${esc(t('zones.directBagsHint'))}">\u26a0 ${esc(t('zones.directBags',{count:directCount}))}</span>`:''}
        ${directCount>0&&z.racks.length?`<button class="btn btn-sm" data-action="bulk-move" data-zone="${esc(z.id)}" style="font-size:10px;color:var(--c-red-dark);font-weight:600">${esc(t('zones.moveToRack'))}</button>`:''}
        <span style="flex:1"></span>
        <button class="btn btn-sm" data-action="rename-zone" data-zone="${esc(z.id)}" style="font-size:11px">${esc(t('batch.zones.rename'))}</button>
        <button class="btn btn-sm" data-action="add-rack" data-zone="${esc(z.id)}" style="font-size:11px">${esc(t('zones.addRack'))}</button>
        <button class="btn btn-sm" data-action="toggle-qr" data-zone="${esc(z.id)}" style="font-size:11px">${esc(t('zones.showQr'))}</button>
        <button class="btn btn-sm" data-action="print-zone-qr" data-zone="${esc(z.id)}" style="font-size:11px">${esc(t('zones.printQr'))}</button>
        ${bagCount===0
          ?`<button class="btn btn-sm btn-r" data-action="del-zone" data-zone="${esc(z.id)}" style="font-size:11px">${t('zones.delete')}</button>`
          :`<button class="btn btn-sm btn-r" disabled title="${esc(t('zones.hasBags',{count:bagCount}))}" style="font-size:11px;opacity:.45;cursor:not-allowed">${t('zones.delete')}</button>`}
      </div>
      <div class="zone-row-racks">${rackHtml}</div>
      <div class="zone-qr-panel" id="zone-qr-${esc(z.id)}" style="display:none"></div>
    </div>`;
  };
  const orderedRoles=[...ROLE_ORDER,...extraRoles];
  el.innerHTML=orderedRoles.map(role=>{
    const zs=groups[role];
    if(!zs||!zs.length)return'';
    const label=esc(t(ROLE_LABELS[role])||role);
    const header=`<div class="zone-group-header">${label}</div>`;
    return header+zs.map(renderZone).join('');
  }).join('');
}
// Drag-and-drop state for zone reordering.
let draggedZoneId=null;
let draggedZoneRole=null;
function clearZoneDropHints(){
  document.querySelectorAll('.zone-row.zone-drop-before,.zone-row.zone-drop-after').forEach(r=>{
    r.classList.remove('zone-drop-before','zone-drop-after');
  });
}
function onZoneDragStart(e){
  const handle=e.target.closest('.zone-drag-handle');
  if(!handle){return}
  const row=handle.closest('.zone-row');
  if(!row){return}
  draggedZoneId=row.dataset.zoneId;
  draggedZoneRole=row.dataset.zoneRole;
  if(e.dataTransfer){
    e.dataTransfer.effectAllowed='move';
    try{e.dataTransfer.setData('text/plain',draggedZoneId)}catch(_){}
    try{
      const rect=row.getBoundingClientRect();
      e.dataTransfer.setDragImage(row,e.clientX-rect.left,e.clientY-rect.top);
    }catch(_){}
  }
  // Delay the dragging class so the browser snapshots the row before we dim it.
  setTimeout(()=>{row.classList.add('zone-dragging')},0);
}
function onZoneDragOver(e){
  if(!draggedZoneId)return;
  const row=e.target.closest('.zone-row');
  if(!row||row.dataset.zoneRole!==draggedZoneRole||row.dataset.zoneId===draggedZoneId){
    clearZoneDropHints();return;
  }
  e.preventDefault();
  if(e.dataTransfer)e.dataTransfer.dropEffect='move';
  const rect=row.getBoundingClientRect();
  const before=(e.clientY-rect.top)<rect.height/2;
  clearZoneDropHints();
  row.classList.add(before?'zone-drop-before':'zone-drop-after');
}
function onZoneDrop(e){
  if(!draggedZoneId)return;
  const row=e.target.closest('.zone-row');
  if(!row||row.dataset.zoneRole!==draggedZoneRole||row.dataset.zoneId===draggedZoneId){
    clearZoneDropHints();return;
  }
  e.preventDefault();
  const rect=row.getBoundingClientRect();
  const before=(e.clientY-rect.top)<rect.height/2;
  const targetId=row.dataset.zoneId;
  const sourceId=draggedZoneId;
  const role=draggedZoneRole;
  clearZoneDropHints();
  reorderZoneWithinRole(sourceId,targetId,before,role);
}
function onZoneDragEnd(){
  document.querySelectorAll('.zone-row.zone-dragging').forEach(r=>r.classList.remove('zone-dragging'));
  clearZoneDropHints();
  draggedZoneId=null;
  draggedZoneRole=null;
}
async function reorderZoneWithinRole(sourceId,targetId,before,role){
  const sameRole=zones
    .filter(x=>x.role===role)
    .sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0)||a.name.localeCompare(b.name));
  const srcIdx=sameRole.findIndex(x=>x.id===sourceId);
  if(srcIdx<0)return;
  const [src]=sameRole.splice(srcIdx,1);
  let tgtIdx=sameRole.findIndex(x=>x.id===targetId);
  if(tgtIdx<0)sameRole.push(src);
  else sameRole.splice(before?tgtIdx:tgtIdx+1,0,src);
  // Build full order: roles in canonical order + any extras, each group in its new local order.
  const groups={};
  ROLE_ORDER.forEach(r=>{groups[r]=[]});
  const extra=[];
  zones.forEach(x=>{
    if(x.role===role)return;
    if(!groups[x.role]){groups[x.role]=[];extra.push(x.role)}
    groups[x.role].push(x);
  });
  groups[role]=sameRole;
  Object.keys(groups).forEach(r=>{
    if(r!==role)groups[r].sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0)||a.name.localeCompare(b.name));
  });
  const fullOrder=[...ROLE_ORDER,...extra].flatMap(r=>groups[r]||[]).map(x=>x.id);
  // Optimistic local update so the UI moves immediately.
  fullOrder.forEach((id,idx)=>{
    const zz=zones.find(x=>x.id===id);
    if(zz)zz.sortOrder=idx+1;
  });
  renderZones();
  try{
    const res=await apiPost('/api/zones/reorder',{order:fullOrder});
    if(res&&res.error){alert(res.error);await loadData()}
  }catch(err){
    console.error('reorder zones error:',err);
    alert('Error reordering zones: '+(err.message||'unknown error'));
    await loadData();
  }
}
async function addZone(){
  const nameRaw=document.getElementById('zone-name').value.trim();
  // ID is derived from uppercase version for stability; display name keeps user casing
  const id=nameRaw.toUpperCase().replace(/[^A-Z0-9]/g,'_').replace(/^_+|_+$/g,'');
  if(!id||id.length<2){alert(t('zones.errShort'));return}
  if(nameRaw.length>50){alert(t('zones.errLong'));return}
  if(!/^[A-Z]/.test(id)){alert(t('zones.errIdStart'));return}
  const dup=zones.find(z=>z.id===id);
  if(dup){alert(t('zones.errExists')+' ('+dup.name+')');return}
  const role=document.getElementById('zone-role').value;
  const color=document.getElementById('zone-color').value;
  const racksRaw=document.getElementById('zone-racks').value.trim();
  const racks=racksRaw?[...new Set(racksRaw.split(',').map(r=>id+'_'+r.trim().toUpperCase().replace(/[^A-Z0-9]/g,'')).filter(r=>r!==id+'_'))]:[];
  if(racks.some(r=>r===id+'_'||r.length<=id.length+1)){alert(t('zones.errRackEmpty'));return}
  if(racks.length>50){alert(t('zones.errTooManyRacks'));return}
  const capVal=document.getElementById('zone-capacity').value.trim();
  const maxCapacity=capVal?parseInt(capVal,10):null;
  if(maxCapacity!==null&&(!Number.isFinite(maxCapacity)||maxCapacity<1)){alert(t('zones.errCapacity'));return}
  try{
    const now=new Date().toISOString();
    const res=await apiPost('/api/zones',{id,name:nameRaw,role,color,sortOrder:zones.length+1,racks,maxCapacity,created:now});
    if(res.error){alert(res.error);return}
    zones.push({id,name:nameRaw,role,color,sortOrder:zones.length+1,maxCapacity,racks:racks.map((r,i)=>({id:r,sortOrder:i+1}))});
    rebuildZoneConstants();renderZones();renderStatus();
    document.getElementById('zone-name').value='';
    document.getElementById('zone-racks').value='';
    document.getElementById('zone-color').value='#10b981';
    document.getElementById('zone-role').value='fruiting';
    document.getElementById('zone-capacity').value='';
  }catch(e){
    console.error('addZone error:',e);
    alert('Error creating zone: '+(e.message||'unknown error'));
  }
}
function renameZone(id){
  const z=zones.find(x=>x.id===id);if(!z)return;
  prompt2(t('batch.zones.renamePrompt',{old:z.name}),z.name,function(newName){
    if(!newName||!newName.trim())return;
    newName=newName.trim();
    if(newName===z.name)return;
    apiPatch('/api/zones/'+encodeURIComponent(id)+'/name',{name:newName}).then(res=>{
      if(res&&res.error){alert(res.error);return}
      z.name=newName;
      renderZones();renderStatus();renderBatches();
    });
  });
}
function removeZone(id){
  const z=zones.find(x=>x.id===id);if(!z)return;
  confirm2(t('zones.deleteTitle'),t('zones.deleteMsg',{name:z.name}),t('zones.delete'),async()=>{
    const res=await apiDelete('/api/zones/'+encodeURIComponent(id));
    if(res.error){alert(res.error);return}
    zones=zones.filter(x=>x.id!==id);
    rebuildZoneConstants();renderZones();renderStatus();
  });
}
function addRackToZone(zoneId){
  prompt2(t('zones.rackPrompt'),'R3',function(name){
    if(!name)return;
    const rackId=zoneId+'_'+name.trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
    if(ALL_RACKS.includes(rackId)){alert(t('zones.errRackExists'));return}
    apiPost('/api/zones/'+encodeURIComponent(zoneId)+'/racks',{id:rackId}).then(res=>{
      if(res.error){alert(res.error);return}
      const zone=zones.find(z=>z.id===zoneId);
      if(zone)zone.racks.push({id:rackId,sortOrder:zone.racks.length+1});
      rebuildZoneConstants();renderZones();renderStatus();
    });
  });
}
function removeRack(rackId){
  confirm2(t('zones.rackDeleteTitle'),t('zones.rackDeleteMsg',{name:rackId}),t('zones.delete'),()=>{
    apiDelete('/api/racks/'+encodeURIComponent(rackId)).then(res=>{
      if(res.error){alert(res.error);return}
      zones.forEach(z=>{z.racks=z.racks.filter(r=>r.id!==rackId)});
      rebuildZoneConstants();renderZones();renderStatus();
    });
  });
}
function bulkMoveToRack(zoneId){
  const z=zones.find(x=>x.id===zoneId);if(!z||!z.racks.length)return;
  const zoneBags=getZoneBags(zoneId);
  const rackIds=new Set(z.racks.map(r=>r.id));
  const directBags=Object.entries(zoneBags).filter(([,b])=>!rackIds.has(b.loc));
  if(!directBags.length)return;
  const m=document.getElementById('m-locmove');
  document.getElementById('lm-title').textContent=t('zones.moveToRackTitle',{count:directBags.length});
  document.getElementById('lm-info').textContent=zoneDisplayName(zoneId);
  document.getElementById('lm-confirm').style.display='none';
  const grid=document.getElementById('lm-grid');
  grid.style.display='flex';
  grid.innerHTML=z.racks.map(r=>{
    const rBags=Object.keys(getRackBags(r.id)).length;
    return`<button class="btn btn-sm" data-action="bulk-rack-target" data-zone="${esc(zoneId)}" data-rack="${esc(r.id)}" style="font-size:12px;padding:8px 12px">${esc(r.id)} (${rBags})</button>`;
  }).join('');
  m.classList.add('open');
}
async function executeBulkMoveToRack(zoneId,rackId){
  const z=zones.find(x=>x.id===zoneId);if(!z)return;
  const zoneBags=getZoneBags(zoneId);
  const rackIds=new Set(z.racks.map(r=>r.id));
  const directBags=Object.entries(zoneBags).filter(([,b])=>!rackIds.has(b.loc));
  if(!directBags.length)return;
  const entries=directBags.map(([bagId,b])=>({action:'MOVE',batch:b.batchId,bag:bagId,from:b.loc,to:rackId,species:b.species,strain:b.strain,time:new Date().toISOString()}));
  const res=await apiPost('/api/scan-log',{entries});
  if(res.error){alert(res.error);return}
  entries.forEach(e=>scanLog.push(e));
  document.getElementById('m-locmove').classList.remove('open');
  renderZones();renderStatus();
  setFb('ok',t('zones.movedToRack',{count:directBags.length,rack:rackId}));
}

// ─── ZONE QR CODES ──────────────────────────────────────────
async function renderZoneQrPanel(zoneId){
  const panel=document.getElementById('zone-qr-'+zoneId);
  if(!panel)return;
  // Toggle if already loaded
  if(panel.dataset.loaded){
    const show=panel.style.display==='none';
    panel.style.display=show?'':'none';
    const btn=panel.closest('.zone-row').querySelector('[data-action="toggle-qr"]');
    if(btn)btn.textContent=show?t('zones.hideQr'):t('zones.showQr');
    return;
  }
  panel.style.display='';
  panel.dataset.loaded='1';
  const btn=panel.closest('.zone-row').querySelector('[data-action="toggle-qr"]');
  if(btn)btn.textContent=t('zones.hideQr');
  const z=zones.find(x=>x.id===zoneId);
  if(!z)return;
  const items=[zoneId,...z.racks.map(r=>r.id)];
  const grid=document.createElement('div');
  grid.className='zone-qr-grid';
  for(const val of items){
    const cell=document.createElement('div');
    cell.className='zone-qr-cell';
    const img=await makeQR(val);
    if(img){img.style.cssText='width:80px;height:80px';cell.appendChild(img)}
    const lbl=document.createElement('div');
    lbl.className='zone-qr-label';
    lbl.textContent=val;
    cell.appendChild(lbl);
    grid.appendChild(cell);
  }
  panel.innerHTML='';
  panel.appendChild(grid);
}

async function printZoneQrBrowser(zoneId){
  const z=zones.find(x=>x.id===zoneId);
  if(!z)return;
  const items=[zoneId,...z.racks.map(r=>r.id)];
  await printQrSheet(items,z.name);
}

async function printAllZoneQrBrowser(){
  const items=[...ZONES,...ALL_RACKS];
  await printQrSheet(items,'All Zones');
}

async function printQrSheet(items,title){
  const sheet=document.getElementById('ref-print-sheet');
  sheet.innerHTML='';
  const hdr=document.createElement('div');
  hdr.style.cssText='font-family:Arial,sans-serif;font-size:15px;font-weight:bold;margin-bottom:12px;padding:8px';
  hdr.textContent='Meisterpilze — QR Codes: '+title;
  sheet.appendChild(hdr);
  const row=document.createElement('div');
  row.style.cssText='display:flex;flex-wrap:wrap;gap:6px;padding:0 8px';
  for(const val of items){
    const cell=document.createElement('div');
    cell.style.cssText='border:1px solid var(--c-border);border-radius:5px;padding:5px 7px;text-align:center;background:var(--c-surface);page-break-inside:avoid';
    const img=await makeQR(val);
    if(img){img.style.width='80px';img.style.height='80px';cell.appendChild(img)}
    const lbl=document.createElement('div');
    lbl.style.cssText='font-size:10px;font-weight:bold;font-family:Arial,sans-serif';
    lbl.textContent=val;
    cell.appendChild(lbl);
    row.appendChild(cell);
  }
  sheet.appendChild(row);
  setTimeout(()=>window.print(),600);
}

// ─── ASSETS (Anlageinventar) ────────────────────────────────
let editingAssetId=null;
let selectedAssetIds=new Set();

function formatEur(n){return n.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})+' €'}

function computeDepreciation(asset,refDate){
  const ref=refDate?new Date(refDate):new Date();
  const entry=new Date(asset.entryDate);
  const isGwg=asset.purchasePrice<=800;
  if(asset.purchasePrice<=0||asset.usefulLife<=0)return{annualDepr:0,accumulated:0,bookValue:asset.purchasePrice,isGwg};
  const annualDepr=asset.purchasePrice/asset.usefulLife;
  // Calculate elapsed days for prorated depreciation
  let msElapsed=ref.getTime()-entry.getTime();
  if(msElapsed<0)msElapsed=0;
  const yearsElapsed=msElapsed/(365.25*24*60*60*1000);
  let accumulated=Math.min(annualDepr*yearsElapsed,asset.purchasePrice);
  accumulated=Math.round(accumulated*100)/100;
  let bookValue=asset.purchasePrice-accumulated;
  // Erinnerungswert: 1€ if fully depreciated but still active
  if(bookValue<1&&asset.status==='aktiv'&&asset.purchasePrice>0)bookValue=1;
  if(bookValue<0)bookValue=0;
  bookValue=Math.round(bookValue*100)/100;
  return{annualDepr:Math.round(annualDepr*100)/100,accumulated,bookValue,isGwg};
}

function nextAssetId(){
  let max=0;
  assets.forEach(a=>{const m=a.assetId.match(/^INV-(\d+)$/);if(m)max=Math.max(max,parseInt(m[1]))});
  return'INV-'+String(max+1).padStart(4,'0');
}

function assetStatusBadge(s){return`<span class="badge badge-${s}">${s.charAt(0).toUpperCase()+s.slice(1)}</span>`}

function renderAssets(){
  const cat=document.getElementById('asset-cat-filter').value;
  const stat=document.getElementById('asset-stat-filter').value;
  const q=(document.getElementById('asset-search').value||'').toLowerCase().trim();
  const now=new Date();

  let rows=assets.filter(a=>{
    if(cat!=='all'&&a.category!==cat)return false;
    if(stat!=='all'&&a.status!==stat)return false;
    if(q){const hay=(a.assetId+' '+a.name+' '+(a.supplier||'')+' '+(a.serialNumber||'')+' '+(a.location||'')).toLowerCase();if(!hay.includes(q))return false}
    return true;
  }).sort((a,b)=>b.assetId.localeCompare(a.assetId));

  // Stats
  const aktiv=assets.filter(a=>a.status==='aktiv');
  const totalPurchase=aktiv.reduce((s,a)=>s+a.purchasePrice,0);
  const totalBook=aktiv.reduce((s,a)=>s+computeDepreciation(a).bookValue,0);
  const gwgCount=aktiv.filter(a=>a.purchasePrice<=800).length;
  document.getElementById('asset-stats').innerHTML=
    `<div class="met"><div class="met-v">${assets.length}</div><div class="met-l">Gesamt</div></div>`+
    `<div class="met"><div class="met-v">${formatEur(totalPurchase)}</div><div class="met-l">Anschaffungswert (aktiv)</div></div>`+
    `<div class="met"><div class="met-v">${formatEur(totalBook)}</div><div class="met-l">Buchwert heute (aktiv)</div></div>`+
    `<div class="met"><div class="met-v">${gwgCount}</div><div class="met-l">GWG (≤ 800 €)</div></div>`;

  // Table
  const body=document.getElementById('assets-body');
  if(!rows.length){body.innerHTML='<tr><td colspan="8" class="empty">Keine Anlagen erfasst. Klicke auf "Hinzufügen" um loszulegen.</td></tr>';return}
  body.innerHTML=rows.map(a=>{
    const d=computeDepreciation(a);
    const gwg=d.isGwg?'<span class="badge badge-gwg" style="margin-left:4px;font-size:9px">GWG</span>':'';
    return`<tr>
      <td style="font-family:monospace;font-size:11px;font-weight:500">${esc(a.assetId)}</td>
      <td>${esc(a.name)}${gwg}</td>
      <td>${esc(a.category)}</td>
      <td style="text-align:right">${formatEur(a.purchasePrice)}</td>
      <td style="text-align:right">${formatEur(d.bookValue)}</td>
      <td>${assetStatusBadge(a.status)}</td>
      <td style="font-size:11px;color:var(--c-text-sec)">${esc(a.location)||'—'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-sm" onclick="editAsset('${esc(a.assetId)}')" style="padding:2px 6px">Bearb.</button>
        <button class="btn btn-sm" onclick="quickPrintAsset('${esc(a.assetId)}')" style="padding:2px 6px">Druck</button>
        <button class="btn btn-sm" onclick="deleteAsset('${esc(a.assetId)}')" style="padding:2px 6px;color:var(--c-red-dark)">×</button>
      </td>
    </tr>`}).join('');
}

function resetAssetForm(){
  editingAssetId=null;
  document.getElementById('asset-name').value='';
  document.getElementById('asset-category').value='Maschinen';
  document.getElementById('asset-entry-date').value=new Date().toISOString().slice(0,10);
  document.getElementById('asset-price').value='';
  document.getElementById('asset-life').value='5';
  document.getElementById('asset-depr-method').value='linear';
  document.getElementById('asset-supplier').value='';
  document.getElementById('asset-invoice').value='';
  document.getElementById('asset-serial').value='';
  document.getElementById('asset-location').value='';
  document.getElementById('asset-status').value='aktiv';
  document.getElementById('asset-exit-date').value='';
  document.getElementById('asset-exit-row').style.display='none';
  document.getElementById('asset-notes').value='';
  document.getElementById('asset-id-preview').textContent='Neue ID: '+nextAssetId();
  // Fill location datalist
  const locs=[...new Set(assets.map(a=>a.location).filter(Boolean))];
  document.getElementById('asset-loc-list').innerHTML=locs.map(l=>`<option value="${esc(l)}">`).join('');
}

function assetStatusChange(){
  const s=document.getElementById('asset-status').value;
  document.getElementById('asset-exit-row').style.display=s==='aktiv'?'none':'block';
}

function editAsset(id){
  const a=assets.find(x=>x.assetId===id);if(!a)return;
  editingAssetId=id;
  document.getElementById('asset-name').value=a.name;
  document.getElementById('asset-category').value=a.category;
  document.getElementById('asset-entry-date').value=a.entryDate;
  document.getElementById('asset-price').value=a.purchasePrice;
  document.getElementById('asset-life').value=a.usefulLife;
  document.getElementById('asset-depr-method').value=a.depreciationMethod||'linear';
  document.getElementById('asset-supplier').value=a.supplier||'';
  document.getElementById('asset-invoice').value=a.invoiceNumber||'';
  document.getElementById('asset-serial').value=a.serialNumber||'';
  document.getElementById('asset-location').value=a.location||'';
  document.getElementById('asset-status').value=a.status;
  document.getElementById('asset-exit-date').value=a.exitDate||'';
  document.getElementById('asset-exit-row').style.display=a.status==='aktiv'?'none':'block';
  document.getElementById('asset-notes').value=a.notes||'';
  document.getElementById('asset-id-preview').textContent='Bearbeiten: '+id;
  openStab('assets','add');
}

function saveAsset(){
  const name=document.getElementById('asset-name').value.trim();
  const category=document.getElementById('asset-category').value;
  const entryDate=document.getElementById('asset-entry-date').value;
  const price=parseFloat(document.getElementById('asset-price').value);
  const life=parseInt(document.getElementById('asset-life').value);
  if(!name||!entryDate||isNaN(price)||price<0||isNaN(life)||life<1){alert('Bitte alle Pflichtfelder ausfüllen.');return}
  const status=document.getElementById('asset-status').value;
  const obj={
    assetId:editingAssetId||nextAssetId(),
    name,category,entryDate,
    exitDate:status!=='aktiv'?document.getElementById('asset-exit-date').value||null:null,
    purchasePrice:price,usefulLife:life,
    depreciationMethod:document.getElementById('asset-depr-method').value,
    supplier:document.getElementById('asset-supplier').value.trim()||null,
    invoiceNumber:document.getElementById('asset-invoice').value.trim()||null,
    serialNumber:document.getElementById('asset-serial').value.trim()||null,
    location:document.getElementById('asset-location').value.trim()||null,
    status,
    notes:document.getElementById('asset-notes').value.trim(),
    created:editingAssetId?(assets.find(a=>a.assetId===editingAssetId)||{}).created||new Date().toISOString():new Date().toISOString()
  };
  if(editingAssetId){const i=assets.findIndex(a=>a.assetId===editingAssetId);if(i>=0)assets[i]=obj;else assets.push(obj)}
  else assets.push(obj);
  apiPost('/api/assets',obj);editingAssetId=null;
  openStab('assets','list');
}

function deleteAsset(id){
  confirm2('Anlage löschen?','Die Anlage '+id+' wird unwiderruflich gelöscht.','Ja, löschen',()=>{
    assets=assets.filter(a=>a.assetId!==id);apiDelete('/api/assets/'+encodeURIComponent(id));renderAssets();
  });
}

// ─── ASSET EXPORT ───────────────────────────────────────────
function initExportTab(){
  const y=new Date().getFullYear();
  document.getElementById('stichtag-date').value=y+'-12-31';
}

function exportAssetCSV(){
  const hdr=['Inventar-Nr','Bezeichnung','Kategorie','Anschaffungsdatum','Anschaffungskosten','Nutzungsdauer (J.)','Jahres-AfA','Kumulierte AfA','Buchwert','GWG','Status','Lieferant','Rechnungsnr','Seriennr','Standort','Abgangsdatum','Bemerkungen'];
  const rows=assets.map(a=>{
    const d=computeDepreciation(a);
    return[a.assetId,a.name,a.category,fmtDE(a.entryDate),fmtNum(a.purchasePrice),a.usefulLife,fmtNum(d.annualDepr),fmtNum(d.accumulated),fmtNum(d.bookValue),d.isGwg?'Ja':'Nein',a.status,a.supplier||'',a.invoiceNumber||'',a.serialNumber||'',a.location||'',a.exitDate?fmtDE(a.exitDate):'',a.notes||''];
  });
  const csv='\uFEFF'+[hdr,...rows].map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(';')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='inventar_'+todayStr()+'.csv';a.click();
}

function fmtDE(iso){if(!iso)return'';const d=new Date(iso);return String(d.getDate()).padStart(2,'0')+'.'+String(d.getMonth()+1).padStart(2,'0')+'.'+d.getFullYear()}
function fmtNum(n){return String(Math.round(n*100)/100).replace('.',',')}

function renderStichtagReport(){
  const ref=document.getElementById('stichtag-date').value;
  if(!ref){alert('Bitte Stichtag wählen.');return}
  const aktiv=assets.filter(a=>a.status==='aktiv'||(a.exitDate&&a.exitDate>ref));
  let totalPurchase=0,totalBook=0,totalAccum=0;
  const rows=aktiv.map(a=>{
    const d=computeDepreciation(a,ref);
    totalPurchase+=a.purchasePrice;totalBook+=d.bookValue;totalAccum+=d.accumulated;
    return`<tr><td style="font-family:monospace;font-size:11px">${esc(a.assetId)}</td><td>${esc(a.name)}</td><td style="text-align:right">${formatEur(a.purchasePrice)}</td><td style="text-align:right">${formatEur(d.accumulated)}</td><td style="text-align:right;font-weight:600">${formatEur(d.bookValue)}</td></tr>`;
  });
  document.getElementById('stichtag-result').innerHTML=
    `<div style="font-size:12px;color:var(--c-text-sec);margin-bottom:6px">Stichtag: ${fmtDE(ref)} — ${aktiv.length} aktive Anlagen</div>`+
    `<div style="overflow-x:auto"><table><thead><tr><th>Nr</th><th>Bezeichnung</th><th>Anschaffungskosten</th><th>Kum. AfA</th><th>Buchwert</th></tr></thead><tbody>`+
    rows.join('')+
    `<tr style="font-weight:700;border-top:2px solid #333"><td colspan="2">Summe</td><td style="text-align:right">${formatEur(totalPurchase)}</td><td style="text-align:right">${formatEur(totalAccum)}</td><td style="text-align:right">${formatEur(totalBook)}</td></tr>`+
    `</tbody></table></div>`;
}

// ─── ASSET LABELS ───────────────────────────────────────────
function renderAssetLabelList(){
  const el=document.getElementById('asset-label-list');
  if(!assets.length){el.innerHTML='<div class="empty">Keine Anlagen vorhanden.</div>';return}
  el.innerHTML=assets.filter(a=>a.status==='aktiv').map(a=>{
    const chk=selectedAssetIds.has(a.assetId)?'checked':'';
    return`<label style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #eee;font-size:12px;cursor:pointer">
      <input type="checkbox" ${chk} onchange="toggleAssetLabel('${esc(a.assetId)}',this.checked)">
      <span style="font-family:monospace;font-weight:500">${esc(a.assetId)}</span>
      <span style="color:var(--c-text-sec)">${esc(a.name)}</span>
      <span style="color:var(--c-text-muted);font-size:11px">${esc(a.category)}</span>
    </label>`;
  }).join('');
}

function toggleAssetLabel(id,on){if(on)selectedAssetIds.add(id);else selectedAssetIds.delete(id)}
function toggleAllAssetLabels(on){
  if(on)assets.filter(a=>a.status==='aktiv').forEach(a=>selectedAssetIds.add(a.assetId));
  else selectedAssetIds.clear();
  renderAssetLabelList();
}

function makeAssetZPL(ids){
  const truncated=[];
  const zpl=ids.map(id=>{
    const a=assets.find(x=>x.assetId===id);if(!a)return'';
    const numBc=barcodeByEntity.get('asset:'+id);
    const bcVal=numBc?String(numBc):id.replace(/-/g,'_');
    const loc=(a.category||'')+(a.location?' / '+a.location:'');
    const nameTrunc=a.name.length>28?a.name.slice(0,26)+'..':a.name;
    if(a.name.length>28||loc.length>36) truncated.push(a.name||id);
    const bc=bcParams(bcVal);
    return'^XA^PW400^LL240^CI28^LH0,0'+
      '^FO'+bc.x+',40^BY'+bc.mw+',2.0,72^BCN,72,N,N,N^FD'+bcVal+'^FS'+
      '^FO0,120^FB400,1,0,C^A0N,30,30^FD'+id+'^FS'+
      '^FO0,156^FB400,1,0,C^A0N,22,22^FD'+nameTrunc+'^FS'+
      '^FO0,182^FB400,1,0,C^A0N,18,18^FD'+loc.slice(0,36)+'^FS'+
      '^XZ';
  }).filter(Boolean).join('\n');
  if(truncated.length) alert('Warning: Label text was truncated for: '+truncated.join(', ')+'. Maximum 26 characters for name, 36 for location.');
  return zpl;
}

async function printAssetLabels(){
  const ids=[...selectedAssetIds];
  if(!ids.length){alert('Bitte mindestens eine Anlage auswählen.');return}
  const zpl=makeAssetZPL(ids);
  const err=await sendToPrinter(zpl);
  if(err)alert('Druckfehler: '+err);
  else setFb('ok',ids.length+' Inventar-Etikett'+(ids.length!==1?'en':'')+' gedruckt');
}

function downloadAssetZPL(){
  const ids=[...selectedAssetIds];
  if(!ids.length){alert('Bitte mindestens eine Anlage auswählen.');return}
  const zpl=makeAssetZPL(ids);
  const blob=new Blob([zpl],{type:'text/plain'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='inventar_labels.zpl';a.click();
}

async function quickPrintAsset(id){
  const zpl=makeAssetZPL([id]);
  const err=await sendToPrinter(zpl);
  if(err){const blob=new Blob([zpl],{type:'text/plain'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=id+'_label.zpl';a.click()}
}

// ─── MUSHROOM STRAINS ────────────────────────────────────────
function fillStrainSelects(){
  const opts='<option value="">'+t('strains.selectPlaceholder')+'</option>'+
    mushroomStrains.map(ms=>`<option value="${ms.id}">${esc(ms.name)} (${esc(ms.kuerzel)})</option>`).join('');
  const hint=mushroomStrains.length===0;
  ['nb-strain-sel','lw-st'].forEach(id=>{
    const el=document.getElementById(id);
    if(!el)return;
    const cur=el.value;
    el.innerHTML=opts;
    if(cur)el.value=cur;
  });
  const nbHint=document.getElementById('nb-no-strains-hint');
  if(nbHint)nbHint.style.display=hint?'block':'none';
}

function renderStrains(){
  const body=document.getElementById('strains-body');
  if(!body)return;
  if(!mushroomStrains.length){
    body.innerHTML='<tr><td colspan="4" class="empty">Noch keine Pilzsorten angelegt.</td></tr>';
    return;
  }
  // Count usage
  const batchCount=id=>batches.filter(b=>b.strainId===id).length;
  const cultureCount=id=>cultures.filter(c=>c.strainId===id).length;
  body.innerHTML=mushroomStrains.map(ms=>{
    const bc=batchCount(ms.id),cc=cultureCount(ms.id);
    const inUse=bc>0||cc>0;
    const usageParts=[];
    if(bc>0)usageParts.push(bc+' '+t('strains.batches'));
    if(cc>0)usageParts.push(cc+' '+t('strains.cultures'));
    const usageText=usageParts.join(', ')||'—';
    return`<tr>
      <td style="font-weight:500">${esc(ms.name)}</td>
      <td><span style="font-family:monospace;font-size:12px;background:var(--c-bg);padding:2px 7px;border-radius:4px">${esc(ms.kuerzel)}</span></td>
      <td style="font-size:12px;color:var(--c-text-sec)">${ms.description?esc(ms.description):'<span style="color:var(--c-text-muted)">—</span>'}</td>
      <td style="font-size:12px;color:var(--c-text-sec)">${esc(usageText)}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-sm" onclick="editMStrain(${ms.id})" style="padding:2px 7px">Bearb.</button>
        <button class="btn btn-sm btn-r" onclick="deleteMStrain(${ms.id})" ${inUse?'disabled title="'+t('strains.deleteProtected')+'"':''} style="padding:2px 7px">&#x2715;</button>
      </td>
    </tr>`;
  }).join('');
}

function saveMStrain(){
  const name=document.getElementById('ms-name').value.trim();
  const kuerzel=document.getElementById('ms-kuerzel').value.trim().toUpperCase();
  const desc=document.getElementById('ms-desc').value.trim();
  const editId=document.getElementById('ms-edit-id').value;
  if(!name||!kuerzel){alert('Name und Kürzel sind Pflichtfelder.');return}
  if(kuerzel.length!==4){alert('Kürzel muss genau 4 Zeichen haben (z.B. LIMA, SHII, AUSP).');return}
  const payload={name,kuerzel,description:desc};
  const req=editId?apiPatch('/api/mushroom-strains/'+editId,payload):apiPost('/api/mushroom-strains',payload);
  req.then(r=>{
    if(r&&r.error){alert('Fehler: '+r.error);return}
    if(!editId&&r&&r.id){mushroomStrains.push({id:r.id,name,kuerzel,description:desc,created:new Date().toISOString()})}
    else if(editId){const ms=mushroomStrains.find(x=>x.id===parseInt(editId));if(ms){ms.name=name;ms.kuerzel=kuerzel;ms.description=desc}}
    mushroomStrains.sort((a,b)=>a.name.localeCompare(b.name));
    fillStrainSelects();
    renderStrains();
    cancelMStrain();
  });
}

function editMStrain(id){
  const ms=mushroomStrains.find(x=>x.id===id);if(!ms)return;
  document.getElementById('ms-name').value=ms.name;
  document.getElementById('ms-kuerzel').value=ms.kuerzel;
  document.getElementById('ms-desc').value=ms.description||'';
  document.getElementById('ms-edit-id').value=id;
  document.getElementById('ms-save-btn').textContent='Änderungen speichern';
  document.getElementById('ms-cancel-btn').style.display='';
  document.getElementById('ms-name').focus();
}

function cancelMStrain(){
  document.getElementById('ms-name').value='';
  document.getElementById('ms-kuerzel').value='';
  document.getElementById('ms-desc').value='';
  document.getElementById('ms-edit-id').value='';
  document.getElementById('ms-save-btn').setAttribute('data-i18n','strains.save');
  document.getElementById('ms-save-btn').textContent=t('strains.save');
  document.getElementById('ms-cancel-btn').style.display='none';
}

function deleteMStrain(id){
  const ms=mushroomStrains.find(x=>x.id===id);if(!ms)return;
  confirm2('Pilzsorte löschen?','Pilzsorte "'+ms.name+'" wirklich löschen?','Löschen',()=>{
    apiDelete('/api/mushroom-strains/'+id).then(r=>{
      if(r&&r.error){alert('Fehler: '+r.error);return}
      mushroomStrains=mushroomStrains.filter(x=>x.id!==id);
      fillStrainSelects();renderStrains();
    });
  });
}

function nbStrainChanged(){
  nbPreview();
}

// ─── CULTURES ────────────────────────────────────────────────
const ctBadge=t=>{const m={MC:'badge-mc',PD:'badge-pd',LC:'badge-lc',G2G:'badge-g2g'};return`<span class="badge ${m[t]||''}">${t}</span>`}
const csBadge=s=>{const m={active:'badge-active',stored:'badge-stored',used:'badge-used',contam:'badge-contam'};return`<span class="badge ${m[s]||''}">${s}</span>`}
// Culture strain display: prefer strainName (kuerzel) from mushroom_strains lookup,
// fall back to legacy free-text strain field for historical rows without strain_id.
function cultureStrainDisplay(c){
  if(c.strainName){
    return esc(c.strainName)+(c.strainKuerzel?' <span style="font-size:10px;color:var(--c-text-muted)">('+esc(c.strainKuerzel)+')</span>':'');
  }
  return esc(c.strain)||'\u2014';
}
function fillCultureSelect(id,types){const s=document.getElementById(id);if(!s)return;const cur=s.value;s.innerHTML='<option value="">— none —</option>'+cultures.filter(c=>(c.status==='active'||c.status==='stored')&&(!types||types.includes(c.type))).map(c=>`<option value="${esc(c.id)}">${esc(c.id)} — ${esc(c.strainName||c.species)}/${esc(c.strainKuerzel||c.strain)} (${esc(c.type)})</option>`).join('');if(cur)s.value=cur}
function renderCultures(){
  const type=document.getElementById('cult-type').value,stat=document.getElementById('cult-stat').value,body=document.getElementById('cultures-body');
  const rows=cultures.filter(c=>(type==='all'||c.type===type)&&(stat==='all'||c.status===stat)).sort((a,b)=>b.created.localeCompare(a.created));
  if(!rows.length){body.innerHTML='<tr><td colspan="9" class="empty">'+t('lab.noCultures')+'</td></tr>';return}
  body.innerHTML=rows.map(c=>`<tr><td style="font-family:monospace;font-size:11px;font-weight:500">${esc(c.id)}</td><td>${ctBadge(c.type)}</td><td>${spDot(c.species)}${esc(c.species)}</td><td>${cultureStrainDisplay(c)}</td><td style="font-family:monospace;font-size:10px;color:var(--c-text-muted)">${esc(c.parentId)||'\u2014'}</td><td style="font-size:10px;color:var(--c-text-muted)">${fmtDt(c.created)}</td><td>${csBadge(c.status)}</td><td style="font-size:11px;color:var(--c-text-sec);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.notes)||'\u2014'}</td><td style="white-space:nowrap"><select onchange="setCultureStatus('${esc(c.id)}',this.value)" style="width:auto;font-size:11px;padding:2px 5px"><option value="active" ${c.status==='active'?'selected':''}>${t('lab.active')}</option><option value="stored" ${c.status==='stored'?'selected':''}>${t('lab.stored')}</option><option value="used" ${c.status==='used'?'selected':''}>${t('lab.usedUp')}</option><option value="contam" ${c.status==='contam'?'selected':''}>${t('lab.contaminated')}</option></select> <button class="btn btn-sm" onclick="quickPrintCulture('${esc(c.id)}')" title="${t('asset.print')}" style="padding:2px 6px">${t('asset.print')}</button> <button class="btn btn-sm btn-r" onclick="deleteCulture('${esc(c.id)}')" title="${t('lab.deleteCulture')}" style="padding:2px 6px">\u2715</button></td></tr>`).join('');
}
function setCultureStatus(id,status){const c=cultures.find(x=>x.id===id);if(c){c.status=status;apiPatch('/api/cultures/'+encodeURIComponent(id),{status});renderCultures()}}
function deleteCulture(id){
  const c=cultures.find(x=>x.id===id);if(!c)return;
  const childCount=cultures.filter(x=>x.parentId===id).length;
  const batchCount=batches.filter(b=>b.sourceId===id).length;
  let warning='';
  if(childCount||batchCount){
    const parts=[];
    if(childCount)parts.push(t('lab.deleteChildren',{n:childCount}));
    if(batchCount)parts.push(t('lab.deleteBatches',{n:batchCount}));
    warning=' \u26A0 '+parts.join(' ')+' '+t('lab.deleteRefWarn');
  }
  confirm2(t('lab.deleteCultureTitle'),t('lab.deleteCultureMsg',{id:id})+warning,t('lab.deleteCulture'),()=>{
    cultures=cultures.filter(x=>x.id!==id);
    apiDelete('/api/cultures/'+encodeURIComponent(id));
    renderCultures();renderLabLog();fillCultureSelect('nb-culture',['PD','LC']);fillCultureSelect('gs-culture',['PD','LC']);
  });
}

// ─── LAB WORK ────────────────────────────────────────────────
function lwUpdate(){
  const type=document.getElementById('lw-type').value;
  const pr=document.getElementById('lw-parent-row'),sr=document.getElementById('lw-source-row'),ql=document.getElementById('lw-qty-lbl');
  const kbRows=document.getElementById('lw-kb-rows'),qtyRow=document.getElementById('lw-qty-row');
  const strainTextRow=document.getElementById('lw-strain-text-row');
  const gsResult=document.getElementById('gs-result');
  // Hide KB result when switching away from KB
  if(type!=='KB'&&gsResult)gsResult.style.display='none';
  if(type==='KB'){
    pr.style.display='none';sr.style.display='none';
    if(qtyRow)qtyRow.style.display='none';
    if(kbRows)kbRows.style.display='flex';
    if(strainTextRow)strainTextRow.style.display='block';
    document.getElementById('lw-prev-box').style.display='none';
    fillCultureSelect('gs-culture',['PD','LC']);
    gsPreview();
  }else{
    if(kbRows)kbRows.style.display='none';
    if(strainTextRow)strainTextRow.style.display='none';
    if(qtyRow)qtyRow.style.display='block';
    if(type==='MC'){pr.style.display='none';sr.style.display='block';ql.textContent=t('lab.qtyTubes')}
    else if(type==='PD'){pr.style.display='block';document.getElementById('lw-parent-lbl').textContent=t('lab.parentMcPdLc');fillParentSelect(['MC','PD','LC']);sr.style.display='none';ql.textContent=t('lab.qtyDishes')}
    else if(type==='LC'){pr.style.display='block';document.getElementById('lw-parent-lbl').textContent=t('lab.sourcePdMc');fillParentSelect(['MC','PD']);sr.style.display='none';ql.textContent=t('lab.qtyFlasks')}
    else{pr.style.display='none';sr.style.display='none';ql.textContent=t('lab.qtyBags')}
    lwPreview();
  }
}
function fillParentSelect(types){const s=document.getElementById('lw-parent');const cur=s.value;s.innerHTML='<option value="">'+t('lab.noneNewIsolation')+'</option>'+cultures.filter(c=>(c.status==='active'||c.status==='stored')&&types.includes(c.type)).map(c=>`<option value="${esc(c.id)}">${esc(c.id)} — ${esc(c.strainName||c.species)}/${esc(c.strainKuerzel||c.strain)}</option>`).join('');if(cur)s.value=cur}
function lwPreview(){
  const type=document.getElementById('lw-type').value;
  const strainId=parseInt(document.getElementById('lw-st')?.value)||null;
  const ms=strainId?mushroomStrains.find(x=>x.id===strainId):null;
  const sp=ms?ms.name:'';
  const qty=parseInt(document.getElementById('lw-qty').value)||1;
  const box=document.getElementById('lw-prev-box'),prev=document.getElementById('lw-prev');
  if(!sp||type==='G2G'||type==='KB'){box.style.display='none';return}
  const prefix=type+'-'+abbrev(sp)+'-'+todayStr()+'-';
  const existing=cultures.filter(c=>c.id.startsWith(prefix)).length;
  prev.textContent=Array.from({length:qty},(_,i)=>prefix+String(existing+i+1).padStart(2,'0')).join('\n');
  box.style.display='block';
}
// lw-st change and lw-qty input listeners live in initEventListeners()
function logLabWork(){
  const type=document.getElementById('lw-type').value;
  const strainSel=document.getElementById('lw-st');
  const strainId=strainSel?parseInt(strainSel.value)||null:null;
  const ms=strainId?mushroomStrains.find(x=>x.id===strainId):null;
  if(!ms){alert(t('lab.selectPilzsorte'));return}
  const sp=ms.name,st=ms.kuerzel;
  const parentId=document.getElementById('lw-parent')?.value||null,qty=parseInt(document.getElementById('lw-qty').value)||1;
  if(type==='G2G'){alert(t('lab.g2gNote'));return}
  const prefix=type+'-'+abbrev(sp)+'-'+todayStr()+'-';
  const existing=cultures.filter(c=>c.id.startsWith(prefix)).length;
  const newC=Array.from({length:qty},(_,i)=>({id:prefix+String(existing+i+1).padStart(2,'0'),type,species:sp,strain:st||'',strainId,strainName:sp,strainKuerzel:st||null,parentId:parentId||null,source:document.getElementById('lw-source')?.value.trim()||null,status:'active',notes:document.getElementById('lw-notes').value.trim(),created:new Date().toISOString()}));
  cultures.push(...newC);apiPost('/api/cultures',{cultures:newC}).then(r=>{if(r&&r.cultureBarcodes){for(const[id,bc]of Object.entries(r.cultureBarcodes)){barcodeRegistry.set(bc,{type:'culture',id});barcodeByEntity.set('culture:'+id,bc)}}});
  document.getElementById('lw-notes').value='';document.getElementById('lw-qty').value='1';
  if(document.getElementById('lw-source'))document.getElementById('lw-source').value='';
  renderLabLog();fillCultureSelect('nb-culture',['PD','LC']);fillCultureSelect('gs-culture',['PD','LC']);lwPreview();
  const ids=newC.map(c=>c.id).join(', ');
  if(confirm(t('lab.logged',{n:newC.length,type:type})+'\n'+ids+'\n\n'+t('lab.printNow'))){
    selectedLabIds=new Set(newC.map(c=>c.id));go('print','n-print');
    setTimeout(()=>{openStab('print','lab');renderLabList();renderLabPreview();},150);
  }
}
function renderLabLog(){const body=document.getElementById('lab-log-body');const rows=[...cultures].sort((a,b)=>b.created.localeCompare(a.created)).slice(0,50);body.innerHTML=rows.length?rows.map(c=>{const name=c.strainName||c.species||'';const kz=c.strainKuerzel||c.strain||'';return`<tr><td style="font-size:10px;color:var(--c-text-muted)">${fmtDt(c.created)}</td><td>${ctBadge(c.type)}</td><td style="font-family:monospace;font-size:11px">${esc(c.id)}</td><td style="font-family:monospace;font-size:10px;color:var(--c-text-muted)">${esc(c.parentId)||'\u2014'}</td><td>${spDot(name)}${esc(name)}${kz?' / '+esc(kz):''}</td></tr>`}).join(''):'<tr><td colspan="5" class="empty">'+t('lab.noLabWork')+'</td></tr>'}

// ─── GRAIN SPAWN (Lab tab) ──────────────────────────────────
const genGrainBatchId=sp=>{const ab=abbrev(sp),dt=todayStr(),prefix='G'+ab+'-'+dt;const n=batches.filter(b=>b.batchId.startsWith(prefix+'-')).length;return prefix+'-'+String(n+1).padStart(2,'0')};
function gsSetWeight(kg){
  document.getElementById('gs-weight').value=kg;
  ['gs-wbtn-07','gs-wbtn-1','gs-wbtn-2','gs-wbtn-5'].forEach(id=>{
    const btn=document.getElementById(id);if(!btn)return;
    const btnKg=parseFloat(btn.textContent);
    btn.className='btn btn-sm'+(btnKg===kg?' btn-p':'');
  });
  gsPreview();
}
function gsPreview(){
  const strainSel=document.getElementById('lw-st');
  const strainId=strainSel?parseInt(strainSel.value)||null:null;
  const ms=strainId?mushroomStrains.find(x=>x.id===strainId):null;
  const sp=ms?ms.name:'';
  const qty=parseInt(document.getElementById('gs-qty').value)||0;
  const bagKg=parseFloat(document.getElementById('gs-weight').value)||0;
  document.getElementById('gs-prev').textContent=(sp)?genGrainBatchId(sp)+' ('+qty+' bags)':'\u2014';
  const el=document.getElementById('gs-mat-preview');
  if(!qty||!bagKg){el.style.display='none';return}
  const totalGrain=qty*bagKg;
  const avail=inventory.stock?.grain||0;
  const enough=avail>=totalGrain;
  el.innerHTML=`<strong>${t('batch.grainNeeded')}</strong> ${totalGrain.toFixed(2)} kg (${qty} \u00d7 ${bagKg} kg)<br>${t('batch.inStock')} ${avail.toFixed(2)} kg \u2192 ${enough?'\u2713 '+t('batch.sufficient'):'\u26A0 '+t('batch.onlyEnoughFor',{n:Math.floor(avail/bagKg)})}`;
  el.style.display='block';
}
function createGrainBatch(){
  const strainSel=document.getElementById('lw-st');
  const strainId=strainSel?parseInt(strainSel.value)||null:null;
  const ms=strainId?mushroomStrains.find(x=>x.id===strainId):null;
  if(!strainId||!ms){alert(t('strains.noStrainsHint'));return}
  const sp=ms.name,st=ms.kuerzel;
  const qty=parseInt(document.getElementById('gs-qty').value)||0;
  const days=parseInt(document.getElementById('gs-days').value)||14;
  const bagKg=parseFloat(document.getElementById('gs-weight').value)||0;
  if(qty<1){alert('Please fill in quantity');return}
  if(!bagKg){alert('Please enter a bag weight');return}
  const lwStrainText=(document.getElementById('lw-strain-text')||{}).value?.trim()||'';
  const batchId=genGrainBatchId(sp);spColor(sp);
  const due=new Date();due.setDate(due.getDate()+days);
  const bags=Array.from({length:qty},(_,i)=>batchId+'-'+String(i+1).padStart(2,'0'));
  batches.push({batchId,species:sp,strain:st,strainId,strainName:ms.name,strainKuerzel:ms.kuerzel,qty,days,substrate:null,bagKg,batchType:'grain',sourceId:document.getElementById('gs-culture').value||null,notes:document.getElementById('lw-notes').value.trim(),strainText:lwStrainText,created:new Date().toISOString(),due:due.toISOString(),bags});
  const batchObj=batches[batches.length-1];
  apiPost('/api/batches',batchObj).then(r=>{
    if(r&&r.error){
      const i=batches.findIndex(b=>b.batchId===batchObj.batchId);
      if(i>=0)batches.splice(i,1);
      alert('Batch konnte nicht gespeichert werden: '+r.error);
      renderBatches();renderStatus();
    }
    if(r&&r.bagBarcodes){for(const[id,bc]of Object.entries(r.bagBarcodes)){barcodeRegistry.set(bc,{type:'bag',id});barcodeByEntity.set('bag:'+id,bc)}}
  });
  // Deduct grain from inventory
  if(!inventory.stock)inventory.stock={hardwood:0,wheatbran:0,gypsum:0,grain:0};
  const grainUsed=qty*bagKg;
  inventory.stock.grain=Math.max(0,(inventory.stock.grain||0)-grainUsed);
  invDeltas([{mat:'grain',deltaKg:-grainUsed,type:'batch',ref:batchId}]);
  if(strainSel)strainSel.value='';
  const lwStrainEl=document.getElementById('lw-strain-text');if(lwStrainEl)lwStrainEl.value='';
  document.getElementById('gs-qty').value='10';document.getElementById('gs-days').value='14';
  document.getElementById('lw-notes').value='';document.getElementById('gs-mat-preview').style.display='none';
  gsPreview();updateTodoBadge();renderBatches();
  // Show zone picker — required before print
  openZonePickModal(batchObj,bags,function(){
    document.getElementById('gs-bags').innerHTML=bags.map(b=>`<span style="font-size:10px;font-family:monospace;background:var(--c-bg);padding:2px 6px;border-radius:4px;color:var(--c-text-sec)">${esc(b)}</span>`).join('');
    document.getElementById('gs-result').style.display='block';
  });
}
function goToPrintGrainBatch(){go('print','n-print');setTimeout(()=>{openStab('print','bags');fillBatchSelect();const last=batches[batches.length-1];if(last){const s=document.getElementById('print-batch');s.value=last.batchId;renderBagPreview()}},100)}

// ─── LINEAGE ─────────────────────────────────────────────────
// Lineage intentionally uses the legacy c.species / c.strain fields so that
// historical rows without a strain_id still render with their original
// species/kuerzel values. Do not swap to strainName here — old lineage nodes
// would lose their labels.
function fillLineageSelect(){const s=document.getElementById('lineage-sel');const cur=s.value;s.innerHTML='<option value="">'+t('lab.selectCultureBatch')+'</option>'+(cultures.length?`<optgroup label="Cultures">${cultures.map(c=>`<option value="C:${esc(c.id)}">${esc(c.id)} (${esc(c.type)} — ${esc(c.species)})</option>`).join('')}</optgroup>`:'')+( batches.length?`<optgroup label="Batches">${batches.map(b=>`<option value="B:${esc(b.batchId)}">${esc(b.batchId)} (${esc(b.species)})</option>`).join('')}</optgroup>`:'');if(cur)s.value=cur}
function buildTree(rootId,rootType){
  const seen=new Set();const getAnc=id=>{if(seen.has(id))return[];seen.add(id);const c=cultures.find(x=>x.id===id);if(!c)return[];const node={id:c.id,type:c.type,species:c.species,strain:c.strain,status:c.status,created:c.created};if(c.parentId){const p=cultures.find(x=>x.id===c.parentId);if(p)return[...getAnc(c.parentId),node]}return[node]};
  const getDesc=(id,depth)=>{if(depth>6)return[];const ch=[];cultures.filter(c=>c.parentId===id).forEach(c=>ch.push({...c,harvest:0,children:getDesc(c.id,depth+1)}));batches.filter(b=>b.sourceId===id).forEach(b=>{const{status}=getStatus(b.batchId);ch.push({id:b.batchId,type:'BATCH',species:b.species,strain:b.strain,status,harvest:getHarvested(b.batchId),created:b.created,children:[]})});return ch};
  if(rootType==='C'){const anc=getAnc(rootId);const c=cultures.find(x=>x.id===rootId);if(!c)return null;const root={...anc[anc.length-1]||{id:c.id,type:c.type,species:c.species,strain:c.strain,status:c.status,created:c.created}};root.children=getDesc(rootId,0);if(anc.length>1){let tree=anc[0],cur=tree;for(let i=1;i<anc.length;i++){anc[i].children=i===anc.length-1?root.children:[];cur.children=[anc[i]];cur=anc[i]}return tree}return root}
  else{const b=batches.find(x=>x.batchId===rootId);if(!b)return null;const{status}=getStatus(b.batchId);const bn={id:b.batchId,type:'BATCH',species:b.species,strain:b.strain,status,harvest:getHarvested(b.batchId),created:b.created,children:[]};if(b.sourceId){const anc=getAnc(b.sourceId);if(anc.length){let tree=anc[0],cur=tree;for(let i=1;i<anc.length;i++){anc[i].children=[];cur.children=[anc[i]];cur=anc[i]}cur.children=[bn];return tree}}return bn}
}
const NODE_BG={MC:'#f3e8ff',PD:'#dbeafe',LC:'#dcfce7',BATCH:'#fff7ed'};
const NODE_BD={MC:'#c084fc',PD:'#93c5fd',LC:'#86efac',BATCH:'#fdba74'};
function treeHtml(node,depth){const ch=node.children?.length?`<div style="margin-left:${depth?20:0}px;padding-left:16px;border-left:2px solid var(--c-border);margin-top:5px">${node.children.map(c=>treeHtml(c,depth+1)).join('')}</div>`:'';const harv=node.harvest>0?`<span class="badge b-harvest" style="margin-left:4px">${node.harvest}g</span>`:'';return`<div style="margin-bottom:5px"><div style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;background:${NODE_BG[node.type]||'#f5f4f0'};border:1px solid ${NODE_BD[node.type]||'#e5e3dd'};border-radius:7px;padding:5px 10px"><span style="font-size:10px;font-weight:600;color:var(--c-text-sec)">${esc(node.type)}</span><span style="font-family:monospace;font-size:12px;font-weight:600">${esc(node.id)}</span><span style="font-size:11px;color:var(--c-text-sec)">${esc(node.species)||''}${node.strain?' / '+esc(node.strain):''}</span><span style="font-size:10px;color:var(--c-text-muted)">${esc(node.status)||''}</span>${harv}<span style="font-size:10px;color:var(--c-text-muted)">${node.created?fmtDt(node.created):''}</span></div>${ch}</div>`}
function renderLineage(){const val=document.getElementById('lineage-sel').value,body=document.getElementById('lineage-body');if(!val){body.innerHTML='<div class="empty">'+t('lab.selectAbove')+'</div>';return}const[type,id]=val.split(':');const tree=buildTree(id,type);body.innerHTML=tree?`<div style="padding:4px 0">${treeHtml(tree,0)}</div>`:'<div class="empty">'+t('lab.noLineageData')+'</div>'}

// ─── BAG INFO MODAL ──────────────────────────────────────────
let biBagId=null,biBatchId=null;
function openBagInfo(bagId,batchId,batch){
  biBagId=bagId;biBatchId=batchId;
  const b=batch||batches.find(x=>x.batchId.toUpperCase()===batchId.toUpperCase());
  const el=document.getElementById('bi-body');
  if(!b){el.innerHTML='<p style="color:var(--c-red-dark)">'+t('batch.notFound')+': '+esc(batchId)+'</p>';document.getElementById('m-baginfo').classList.add('open');return}
  document.getElementById('bi-title').textContent=bagId;
  // Current location
  const bagLogs=scanLog.filter(e=>(e.bag||'').toUpperCase()===bagId.toUpperCase());
  let currentLoc=t('bagInfo.notPlaced');
  if(bagLogs.length){
    const last=bagLogs[bagLogs.length-1];
    if(last.action==='REMOVE')currentLoc=t('bagInfo.removed');
    else if(last.action==='ADD'||last.action==='MOVE')currentLoc=last.to||'Unknown';
  }
  // Harvests for this bag
  const bagHarvests=harvests.filter(h=>(h.bag||'').toUpperCase()===bagId.toUpperCase());
  const totalHarv=bagHarvests.reduce((s,h)=>s+(h.grams||0),0);
  el.innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
      <div class="met"><div class="met-l">${t('batch.species')}</div><div style="font-size:15px;font-weight:600">${spDot(b.species)}${esc(b.species)}</div></div>
      <div class="met"><div class="met-l">${t('batch.strain')}</div><div style="font-size:15px;font-weight:600">${b.strainName?(esc(b.strainName)+' <span style="font-size:12px;color:var(--c-text-muted)">('+esc(b.strainKuerzel||b.strain||'')+')</span>'):(esc(b.strain)||'\u2014')}</div></div>
      <div class="met"><div class="met-l">${t('bagInfo.currentLocation')}</div><div style="font-size:15px;font-weight:600;color:var(--c-blue-dark)">${esc(currentLoc)}</div></div>
      <div class="met"><div class="met-l">${t('dash.totalHarvested')}</div><div style="font-size:15px;font-weight:600;color:var(--c-amber-dark)">${totalHarv>0?totalHarv+'g':t('bagInfo.noneYet')}</div></div>
    </div>
    <div style="font-size:11px;font-weight:600;color:var(--c-text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">${t('batch.batchId')} ${esc(b.batchId)} \u2014 ${t('bagInfo.allBags')}</div>
    <div style="display:flex;flex-wrap:wrap;gap:4px;max-height:120px;overflow-y:auto">
      ${b.bags.map(bag=>{
        const isThis=bag.toUpperCase()===bagId.toUpperCase();
        const bagNum=bag.split('-').pop();
        const bagLast=[...scanLog].reverse().find(e=>(e.bag||'').toUpperCase()===bag.toUpperCase());
        const loc=!bagLast?'—':bagLast.action==='REMOVE'?'✗':bagLast.to||'?';
        return`<span style="font-size:11px;font-family:monospace;padding:3px 8px;border-radius:5px;background:${isThis?'var(--c-text)':'var(--c-bg)'};color:${isThis?'#fff':'var(--c-text-sec)'};border:1px solid ${isThis?'var(--c-text)':'var(--c-border)'}" title="${loc}">
          ${bagNum} <span style="font-size:9px;color:${isThis?'var(--c-text-muted)':'var(--c-border)'}">${loc}</span>
        </span>`;
      }).join('')}
    </div>
    ${bagHarvests.length?`<div style="margin-top:10px;font-size:12px;color:var(--c-amber-dark)"><strong>${t('harvest.log')}:</strong> ${bagHarvests.map(h=>`Flush ${h.flush}: ${h.grams}g`).join(' \u00b7 ')}</div>`:''}
  `;
  closeCamScan();
  closeScanModal();
  document.getElementById('m-baginfo').classList.add('open');
  setFb('info',t('scanFb.bagInfo',{bag:bagId}),{noModal:true});
}
function biSetAction(action){
  document.getElementById('m-baginfo').classList.remove('open');
  scan.action=action;scan.from=null;scan.to=null;scan.harvestBag=null;
  updateSD();
  if(action==='HARVEST'){
    showHarvestPanel(biBagId,biBatchId);
  }else if(action==='REMOVE'){
    const bagLast=[...scanLog].reverse().find(e=>(e.bag||'').toUpperCase()===biBagId.toUpperCase()&&(e.action==='ADD'||e.action==='MOVE'));
    const fromLoc=bagLast?bagLast.to:null;
    const b=batches.find(x=>x.batchId.toUpperCase()===(biBatchId||'').toUpperCase());
    const tempId='s'+(++_scanTempIdCounter);
    const entry={time:new Date().toISOString(),action:'REMOVE',batch:biBatchId,bag:biBagId,from:fromLoc,to:null,species:b?.species||null,strain:b?.strain||null,user:currentUser?.username||null,_tempId:tempId};
    scanLog.push(entry);movements.push(entry);
    if(!sessionStartTime)sessionStartTime=Date.now();
    sessionEntries.push(entry);
    scan.count++;
    apiPost('/api/scan-log',{entries:[entry]}).then(function(r){if(r&&r.ids&&r.ids[0])entry._serverId=r.ids[0]});
    updateSD();
    setFb('ok',t('scanFb.removeLogged',{bag:biBagId}),entry);
  }else{
    setFb('ok',t('scanFb.actionReady',{action:action}));
  }
}
document.getElementById('m-baginfo').addEventListener('click',e=>{if(e.target.id==='m-baginfo')document.getElementById('m-baginfo').classList.remove('open')});

// ─── PRINT — BAG LABELS ──────────────────────────────────────
// ─── PRINT via server → ZPL → Windows spooler → GK420d ──────
// Correct size/orientation automatically — no browser dialog issues.
// Hyphens encoded as underscores in barcode to fix German keyboard scanning.

// Legacy species abbreviation (only used for scanning old barcode labels).
function spAbbrev(species){
  if(!species)return'XX';
  const words=species.trim().split(/\s+/);
  if(words.length===1)return words[0].slice(0,2).toUpperCase();
  return(words[0][0]+words[1][0]).toUpperCase();
}
// Calculate Code 128 module width + centered x-offset for ZPL labels.
// Label is 400 dots wide; need 20-dot quiet zone each side → 360 usable dots.
// Code 128 symbol ≈ (35 + chars*11) modules. Use mw=2 if it fits, else mw=1.
// Returns {mw, x} where x centers the barcode horizontally with minimum quiet zones.
// Code 128 quiet zone = 10× module width. Try mw=3, then 2, then 1.
// qzMult: quiet zone multiplier (default 10). Use 5 for lab labels to allow wider bars.
function bcParams(val,qzMult){const mods=35+val.length*11;let mw=3;qzMult=qzMult||10;const qz=m=>m*qzMult;while(mw>1&&mods*mw+2*qz(mw)>400)mw--;const w=mods*mw;return{mw,x:Math.max(qz(mw),Math.round((400-w)/2))}}

// ─── Unified label layout: SINGLE SOURCE OF TRUTH for ZPL + preview ───
// Canvas is 400×240 dots (50×30mm @ 203dpi). bagLabelItems/labLabelItems
// describe one label as a plain array of items in that coordinate system;
// itemsToZPL turns them into printer output and buildPreviewCell renders
// the same items as an SVG with viewBox="0 0 400 240". Because both come
// from the same items array the preview cannot drift from what prints.
// Item shapes:
//   {type:'barcode', x, y, w, h, val, mw}
//   {type:'text',    x?, y, blockW?, fontH, fontW?, text, bold?}
//   {type:'qr',      x, y, size, val}

function itemsToZPL(items){
  // Compute label height from content (min 160, max 240) so short labels don't waste media.
  let maxY=140;
  for(const it of items){
    const bottom=it.type==='barcode'?(it.y+it.h):(it.type==='text'?(it.y+it.fontH):(it.y+(it.size||80)));
    if(bottom>maxY)maxY=bottom;
  }
  const ll=Math.min(240,Math.max(160,maxY+10));
  let z='^XA^PW400^LL'+ll+'^CI28^LH0,0';
  for(const it of items){
    if(it.type==='barcode'){
      z+='^FO'+it.x+','+it.y+'^BY'+it.mw+',2.0,'+it.h+'^BCN,'+it.h+',N,N,N^FD'+it.val+'^FS';
    }else if(it.type==='text'){
      const fw=it.fontW||it.fontH;
      const bw=it.blockW||400;
      const bx=it.x||0;
      z+='^FO'+bx+','+it.y+'^FB'+bw+',1,0,C^A0N,'+it.fontH+','+fw+'^FD'+it.text+'^FS';
      // ZPL has no bold flag; double-draw at x+1 thickens strokes.
      if(it.bold) z+='^FO'+(bx+1)+','+it.y+'^FB'+bw+',1,0,C^A0N,'+it.fontH+','+fw+'^FD'+it.text+'^FS';
    }else if(it.type==='qr'){
      z+='^FO'+it.x+','+it.y+'^BQN,2,4^FDMM,A'+it.val+'^FS';
    }
  }
  return z+'^XZ';
}

// Builds one preview cell as an SVG. Returns {cell, deferred} — insert cell
// into the DOM first, then call renderPreviewDeferred(deferred) to attach
// JsBarcode/QRCode content to the live nodes.
function buildPreviewCell(items){
  const cell=document.createElement('div');
  cell.style.cssText='position:relative;border:1px solid var(--c-border);border-radius:5px;background:#fff;overflow:hidden;aspect-ratio:5/3';
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 400 240');
  svg.setAttribute('xmlns','http://www.w3.org/2000/svg');
  svg.style.cssText='position:absolute;inset:0;width:100%;height:100%;display:block';
  cell.appendChild(svg);
  const deferred=[];
  for(const it of items){
    if(it.type==='barcode'){
      const inner=document.createElementNS('http://www.w3.org/2000/svg','svg');
      inner.setAttribute('x',it.x);
      inner.setAttribute('y',it.y);
      inner.setAttribute('width',it.w);
      inner.setAttribute('height',it.h);
      svg.appendChild(inner);
      deferred.push({kind:'bc',el:inner,val:it.val,mw:it.mw,w:it.w,h:it.h});
    }else if(it.type==='text'){
      const bw=it.blockW||400;
      const cx=(it.x||0)+bw/2;
      // ZPL A0 font height ≈ character height; baseline ≈ 82% from top.
      const by=it.y+it.fontH*0.82;
      const t=document.createElementNS('http://www.w3.org/2000/svg','text');
      t.setAttribute('x',cx);
      t.setAttribute('y',by);
      t.setAttribute('text-anchor','middle');
      t.setAttribute('font-family','Helvetica,Arial,sans-serif');
      t.setAttribute('font-size',it.fontH);
      t.setAttribute('fill','#000');
      if(it.bold) t.setAttribute('font-weight','bold');
      t.textContent=it.text;
      svg.appendChild(t);
    }else if(it.type==='qr'){
      // QR as HTML overlay positioned with % from ZPL coords (qrcode.js → img/canvas).
      const qrDiv=document.createElement('div');
      const L=(it.x/400*100).toFixed(2);
      const T=(it.y/240*100).toFixed(2);
      const W=(it.size/400*100).toFixed(2);
      qrDiv.style.cssText='position:absolute;left:'+L+'%;top:'+T+'%;width:'+W+'%;aspect-ratio:1;background:#fff';
      cell.appendChild(qrDiv);
      deferred.push({kind:'qr',el:qrDiv,val:it.val});
    }
  }
  return {cell,deferred};
}

function renderPreviewDeferred(deferred,baseDelay){
  baseDelay=baseDelay||20;
  deferred.forEach((d,i)=>{
    setTimeout(()=>{
      if(d.kind==='bc'){
        try{
          JsBarcode(d.el,d.val,{format:'CODE128',width:d.mw,height:d.h,displayValue:false,margin:0,background:'#fff',lineColor:'#000'});
          // JsBarcode rewrites width/height on the svg; capture those as a
          // viewBox and restore our (x,y,w,h) so bars stretch to our cell.
          const w=parseFloat(d.el.getAttribute('width'))||d.w;
          const h=parseFloat(d.el.getAttribute('height'))||d.h;
          d.el.setAttribute('viewBox','0 0 '+w+' '+h);
          d.el.setAttribute('width',d.w);
          d.el.setAttribute('height',d.h);
          d.el.setAttribute('preserveAspectRatio','none');
        }catch{}
      }else if(d.kind==='qr'){
        try{
          new QRCode(d.el,{text:d.val,width:64,height:64,colorDark:'#000',colorLight:'#fff',correctLevel:QRCode.CorrectLevel.L});
          const img=d.el.querySelector('img')||d.el.querySelector('canvas');
          if(img){img.style.cssText='display:block;width:100%;height:100%'}
        }catch{}
      }
    },baseDelay+i*12);
  });
}

// detail levels for bag labels:
//   'minimal' — barcode + Line 1 (bag ID) only
//   'sorte'   — + Line 2 (Pilzsorte written out + notes)
//   'full'    — + Line 3 (Fälligkeit)
function bagLabelItems(bagId,batch,detail,_legacyFallbackIds){
  const items=[];
  // Numeric barcode: lookup from barcode registry, fall back to legacy encoding
  const numBc=barcodeByEntity.get('bag:'+bagId);
  let bcVal;
  if(numBc){
    bcVal=String(numBc);
  }else{
    // Legacy fallback for bags without barcode assignment
    if(_legacyFallbackIds) _legacyFallbackIds.push(bagId);
    const isGrain=batch.batchType==='grain';
    const parts=bagId.split('-');
    if(parts.length===4){
      const kz=(batch.strainKuerzel||batch.strain||'BAGX').toUpperCase();
      const mmdd=parts[1].slice(2,4)+parts[1].slice(0,2);
      const bagNum=parseInt(parts[3],10);
      bcVal=(isGrain?'G':'')+kz+'_'+mmdd+'_'+bagNum;
    }else{
      bcVal=bagId.replace(/-/g,'_');
    }
  }
  const bc=bcParams(bcVal);
  // Fixed barcode size regardless of detail level: ≥5mm top margin (40 dots),
  // 90-dot barcode fits all 3 text lines below within the 240-dot canvas.
  const bcY=40,bcH=90;
  items.push({type:'barcode',x:bc.x,y:bcY,w:400-2*bc.x,h:bcH,val:bcVal,mw:bc.mw});
  // Line 1 — bag ID in monospaced kürzel format (always shown)
  const line1Y=bcY+bcH+6;
  items.push({type:'text',y:line1Y,fontH:24,text:bagId});
  if(detail==='sorte'||detail==='full'){
    // Line 2 — Pilzsorte + free-text strain + notes (notes capped at 13 chars on label)
    const species=batch.strainName||batch.species||'';
    const strainTxt=(batch.strainText||'').trim();
    const rawNotes=(batch.notes||'').trim();
    const notes=rawNotes.length>13?rawNotes.slice(0,13)+'\u2026':rawNotes;
    let parts=[species];
    if(strainTxt)parts.push(strainTxt);
    if(notes)parts.push(notes);
    const line2=parts.join(' \u2013 ');
    if(line2) items.push({type:'text',y:line1Y+28,fontH:24,text:line2});
  }
  if(detail==='full'&&batch.due){
    // Line 3 — Fälligkeit, bold
    const due=new Date(batch.due);
    const dueStr=String(due.getDate()).padStart(2,'0')+'.'+String(due.getMonth()+1).padStart(2,'0')+'.'+due.getFullYear();
    const line3Y=(detail==='full')?line1Y+56:line1Y+28;
    items.push({type:'text',y:line3Y,fontH:28,text:'F\u00e4llig: '+dueStr,bold:true});
  }
  return items;
}

function labLabelItems(id,c,opts){
  const items=[];
  // Prefer mushroom_strains lookup fields; fall back to legacy species/strain.
  const name=c.strainName||c.species||'';
  const kz=c.strainDescriptor||'';
  const sp=name+(kz?' \u2013 '+kz:'');
  const ds=fmtDt(c.created);
  // Numeric barcode: lookup from registry, fall back to legacy encoding
  const numBc=barcodeByEntity.get('culture:'+id);
  const bcVal=numBc?String(numBc):id.replace(/-/g,'_');
  const bc=bcParams(bcVal);
  // Fixed barcode size — same as bag labels: ≥5mm top margin, 90-dot height.
  const bcY=40,bcH=90;
  // QR occupies the right ~128 dots; text and barcode stay left of it
  const textBlockW=opts.qr?272:400;
  if(opts.bc){
    const bcW=opts.qr?Math.max(0,272-2*bc.x):(400-2*bc.x);
    items.push({type:'barcode',x:bc.x,y:bcY,w:bcW,h:bcH,val:bcVal,mw:bc.mw});
  }
  // Line 1 — culture ID, optionally with parent appended (fontH 24 matching bag labels)
  const line1Y=opts.bc?bcY+bcH+6:12;
  const line1Text=opts.par&&c.parentId?id+' \u2190 '+c.parentId:id;
  items.push({type:'text',x:0,y:line1Y,blockW:textBlockW,fontH:24,text:line1Text});
  // Line 2 — species + descriptor (fontH 24, same as bag Pilzsorte line)
  if(opts.sp&&sp) items.push({type:'text',x:0,y:line1Y+28,blockW:textBlockW,fontH:24,text:sp});
  // Line 3 — date created, bold (fontH 28, same as bag Fälligkeit line)
  if(opts.dt){
    const line3Y=line1Y+(opts.sp&&sp?56:28);
    items.push({type:'text',x:0,y:line3Y,blockW:textBlockW,fontH:28,text:ds,bold:true});
  }
  if(opts.qr) items.push({type:'qr',x:280,y:bcY,size:108,val:id});
  return items;
}

function makeBagZPL(bags,batch,detail){
  const legacyFallbackIds=[];
  const zpl=bags.map(bagId=>itemsToZPL(bagLabelItems(bagId,batch,detail,legacyFallbackIds))).join('\n');
  if(legacyFallbackIds.length){
    console.warn('makeBagZPL: numeric barcodes not found for bags, used legacy fallback:', legacyFallbackIds);
    alert('Warning: Numeric barcodes not found for bags: '+legacyFallbackIds.join(', ')+'. Legacy text barcodes were used instead.');
  }
  return zpl;
}

function makeLabZPL(ids,opts){
  return ids.map(id=>{
    const c=cultures.find(x=>x.id===id);
    return c?itemsToZPL(labLabelItems(id,c,opts)):'';
  }).filter(Boolean).join('\n');
}



function toggleBagRange(){document.getElementById('bag-range-inputs').style.display=document.getElementById('print-range').value==='range'?'inline-flex':'none'}

async function printBagLabels(){
  const b=batches.find(x=>x.batchId===document.getElementById('print-batch').value);
  if(!b){alert('Select a batch first.');return}
  let bags=b.bags;
  if(document.getElementById('print-range').value==='range'){
    const from=parseInt(document.getElementById('bag-from').value)||1;
    const to=parseInt(document.getElementById('bag-to').value)||b.bags.length;
    bags=b.bags.filter(bagId=>{const n=parseInt(bagId.split('-').pop());return n>=from&&n<=to});
    if(!bags.length){alert('No bags in that range.');return}
  }
  const zpl=makeBagZPL(bags,b,document.getElementById('print-mode').value);
  if(!zpl||!zpl.includes('^XA')){alert('No labels to print. Please check your selection.');return}
  const err=await sendToPrinter(zpl);
  if(err)alert('Print error: '+err);
  else setFb('ok','Printed '+bags.length+' labels for '+b.batchId);
}

async function printLabLabels(){
  const ids=[...selectedLabIds];
  if(!ids.length){alert('Select at least one culture.');return}
  const zpl=makeLabZPL(ids,getLabOpts());
  if(!zpl||!zpl.includes('^XA')){alert('No labels to print. Please check your selection.');return}
  const err=await sendToPrinter(zpl);
  if(err)alert('Print error: '+err);
  else setFb('ok','Printed '+ids.length+' lab label'+(ids.length!==1?'s':''));
}

async function quickPrintCulture(id){
  const zpl=makeLabZPL([id],{bc:true,qr:false,sp:true,par:true,dt:true});
  const err=await sendToPrinter(zpl);
  if(err){
    // fallback: download ZPL
    const blob=new Blob([zpl],{type:'text/plain'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=id+'_label.zpl';a.click();
  }
}

async function sendToPrinter(zpl){
  try{
    const r=await authFetch('/api/print',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({zpl})});
    const d=await r.json();
    if(d.ok)return null;
    return d.error||'Print failed';
  }catch(e){return'Could not reach server: '+e.message;}
}



function fillBatchSelect(){const s=document.getElementById('print-batch');const cur=s.value;s.innerHTML='<option value="">— choose batch —</option>'+batches.map(b=>`<option value="${esc(b.batchId)}">${esc(b.batchId)} (${esc(b.species)} / ${esc(b.strain)})</option>`).join('');if(cur)s.value=cur}

function renderBagPreview(){
  const id=document.getElementById('print-batch').value;
  const el=document.getElementById('bag-preview');
  const mode=document.getElementById('print-mode').value;
  if(!id){el.innerHTML='<div class="empty">Select a batch above.</div>';return}
  const batch=batches.find(b=>b.batchId===id);
  if(!batch)return;
  const wrap=document.createElement('div');
  wrap.style.cssText='display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px';
  const allDeferred=[];
  batch.bags.forEach(bagId=>{
    const {cell,deferred}=buildPreviewCell(bagLabelItems(bagId,batch,mode));
    wrap.appendChild(cell);
    allDeferred.push(...deferred);
  });
  el.innerHTML='';
  el.appendChild(wrap);
  renderPreviewDeferred(allDeferred,30);
}

let selectedLabIds=new Set();
function renderLabList(){const filter=document.getElementById('lab-filter').value,el=document.getElementById('lab-list'),today=todayStr();const rows=cultures.filter(c=>{if(filter==='all')return c.status==='active'||c.status==='stored';if(filter==='today'){const d=new Date(c.created);return String(d.getFullYear()).slice(2)+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0')===today}return c.type===filter}).sort((a,b)=>b.created.localeCompare(a.created));el.innerHTML=rows.length?rows.map(c=>`<label style="display:flex;align-items:center;gap:7px;padding:4px 0;cursor:pointer;font-size:12px;border-bottom:0.5px solid #f0ede8"><input type="checkbox" ${selectedLabIds.has(c.id)?'checked':''} onchange="toggleLabId('${esc(c.id)}',this.checked)" style="width:14px;height:14px;margin:0" /><span style="font-family:monospace;font-weight:500">${esc(c.id)}</span><span class="badge ${c.type==='MC'?'badge-mc':c.type==='PD'?'badge-pd':'badge-lc'}">${esc(c.type)}</span><span style="color:var(--c-text-muted)">${esc(c.species)}${c.strain?' / '+esc(c.strain):''}</span></label>`).join(''):'<div style="font-size:12px;color:var(--c-text-muted);padding:6px">No cultures match.</div>'}
function toggleLabId(id,on){if(on)selectedLabIds.add(id);else selectedLabIds.delete(id);renderLabPreview()}
function getLabOpts(){return{bc:document.getElementById('lp-bc').checked,qr:document.getElementById('lp-qr').checked,sp:document.getElementById('lp-sp').checked,par:document.getElementById('lp-par').checked,dt:document.getElementById('lp-dt').checked}}
function renderLabPreview(){
  const el=document.getElementById('lab-preview');
  const ids=[...selectedLabIds];
  if(!ids.length){el.innerHTML='<div class="empty">Tick cultures in the list to preview labels.</div>';return}
  const opts=getLabOpts();
  const wrap=document.createElement('div');
  wrap.style.cssText='display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px';
  const allDeferred=[];
  ids.forEach(id=>{
    const c=cultures.find(x=>x.id===id);
    if(!c)return;
    const {cell,deferred}=buildPreviewCell(labLabelItems(id,c,opts));
    wrap.appendChild(cell);
    allDeferred.push(...deferred);
  });
  el.innerHTML='';
  el.appendChild(wrap);
  renderPreviewDeferred(allDeferred,30);
}

// ─── REF BARCODES ────────────────────────────────────────────
async function makeQR(val){return new Promise(resolve=>{const div=document.createElement('div');div.style.cssText='display:inline-block';try{new QRCode(div,{text:val,width:120,height:120,colorDark:'#000',colorLight:'#fff',correctLevel:QRCode.CorrectLevel.L});setTimeout(()=>{const img=div.querySelector('img')||div.querySelector('canvas');if(img){img.style.cssText='display:block;width:100%;height:auto';resolve(img)}else resolve(null)},100)}catch{resolve(null)}})}

async function renderRefBarcodes(){const grid=document.getElementById('ref-grid');grid.innerHTML='';const useQR=document.getElementById('ref-qr').checked;for(const group of REF_GROUPS){const card=document.createElement('div');card.className='card';card.innerHTML=`<div class="sec">${group.g}</div>`;const row=document.createElement('div');row.style.cssText='display:flex;flex-wrap:wrap;gap:20px;margin-top:12px;align-items:flex-end';for(const item of group.items){const val=item.val,label=item.label;const cell=document.createElement('div');cell.className='bc-cell';cell.style.cssText='min-width:140px;text-align:center;padding:8px 12px;border:1px solid var(--c-border);border-radius:6px;background:var(--c-surface)';if(useQR){const img=await makeQR(val);if(img)cell.appendChild(img);const lbl=document.createElement('div');lbl.style.cssText='font-size:12px;font-weight:700;color:var(--c-text-sec);margin-top:5px';lbl.textContent=label;cell.appendChild(lbl)}else{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.style.cssText='display:block';cell.appendChild(svg);setTimeout(()=>{try{JsBarcode(svg,val,{format:'CODE128',width:2,height:60,displayValue:false,margin:14,background:'#fff',lineColor:'#000'})}catch{}},20);const lbl=document.createElement('div');lbl.style.cssText='font-size:12px;font-weight:700;color:var(--c-text-sec);margin-top:5px;text-align:center';lbl.textContent=label;cell.appendChild(lbl)}row.appendChild(cell)}card.appendChild(row);grid.appendChild(card)}}
async function printRef(){const sheet=document.getElementById('ref-print-sheet');sheet.innerHTML='';const useQR=document.getElementById('ref-qr').checked;const title=document.createElement('div');title.style.cssText='font-family:Arial,sans-serif;font-size:15px;font-weight:bold;margin-bottom:12px;padding:8px';title.textContent='Meisterpilze — Reference '+(useQR?'QR Codes':'Barcodes');sheet.appendChild(title);let delay=0;for(const group of REF_GROUPS){const sec=document.createElement('div');sec.style.cssText='font-family:Arial,sans-serif;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:.08em;color:var(--c-text-muted);margin:14px 8px 8px';sec.textContent=group.g;sheet.appendChild(sec);const row=document.createElement('div');row.style.cssText='display:flex;flex-wrap:wrap;gap:20px;padding:0 8px';for(const item of group.items){const val=item.val,label=item.label;const cell=document.createElement('div');cell.style.cssText='border:1px solid var(--c-border);border-radius:6px;padding:12px 16px;text-align:center;background:var(--c-surface);page-break-inside:avoid';if(useQR){const img=await makeQR(val);if(img){img.style.width='90px';img.style.height='90px';cell.appendChild(img)}const lbl=document.createElement('div');lbl.style.cssText='font-size:11px;font-weight:bold;font-family:Arial,sans-serif;margin-top:5px';lbl.textContent=label;cell.appendChild(lbl)}else{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');cell.appendChild(svg);setTimeout(()=>{try{JsBarcode(svg,val,{format:'CODE128',width:2,height:60,displayValue:false,margin:14,background:'#fff',lineColor:'#000'})}catch{}},delay);delay+=25;const lbl=document.createElement('div');lbl.style.cssText='font-size:11px;font-weight:bold;font-family:Arial,sans-serif;margin-top:5px';lbl.textContent=label;cell.appendChild(lbl)}row.appendChild(cell)}sheet.appendChild(row)}setTimeout(()=>window.print(),useQR?800:delay+200)}

// ─── GLOBAL SCAN ENGINE ──────────────────────────────────────
// Session tracking
let sessionEntries=[];
let sessionStartTime=null;
let sessionErrors=0;
let _lastScanVal=null;
// Audio feedback
let _scanAudioCtx=null;
let scanAudioEnabled=true;
// iOS requires AudioContext creation during a user gesture; call this from gesture handlers
function _initScanAudio(){
  if(!_scanAudioCtx){try{_scanAudioCtx=new(window.AudioContext||window.webkitAudioContext)()}catch{}}
  if(_scanAudioCtx&&_scanAudioCtx.state==='suspended')_scanAudioCtx.resume().catch(function(){});
}
function _scanBeep(freq,dur){
  if(!scanAudioEnabled)return;
  try{
    _initScanAudio();
    if(!_scanAudioCtx)return;
    var o=_scanAudioCtx.createOscillator();var g=_scanAudioCtx.createGain();
    o.connect(g);g.connect(_scanAudioCtx.destination);
    o.frequency.value=freq;g.gain.value=0.15;o.start();
    g.gain.exponentialRampToValueAtTime(0.001,_scanAudioCtx.currentTime+dur/1000);
    o.stop(_scanAudioCtx.currentTime+dur/1000);
  }catch{}
}
// Pleasant success chirp: 880Hz sine, 120ms with soft attack/release envelope
function _scanBeepOk(){
  if(!scanAudioEnabled)return;
  try{
    _initScanAudio();
    if(!_scanAudioCtx)return;
    var ctx=_scanAudioCtx;var now=ctx.currentTime;
    var o=ctx.createOscillator();var g=ctx.createGain();
    o.type='sine';o.frequency.setValueAtTime(880,now);
    o.connect(g);g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001,now);
    g.gain.exponentialRampToValueAtTime(0.22,now+0.015);
    g.gain.exponentialRampToValueAtTime(0.0001,now+0.12);
    o.start(now);o.stop(now+0.13);
  }catch{}
}
// Sharp error buzz: two dissonant square waves (280Hz + 350Hz), 350ms with gap
function _scanBeepErr(){
  if(!scanAudioEnabled)return;
  try{
    _initScanAudio();
    if(!_scanAudioCtx)return;
    var ctx=_scanAudioCtx;var t0=ctx.currentTime;
    function tone(start,dur){
      var o1=ctx.createOscillator();var o2=ctx.createOscillator();var g=ctx.createGain();
      o1.type='square';o2.type='square';
      o1.frequency.setValueAtTime(280,start);
      o2.frequency.setValueAtTime(350,start);
      o1.connect(g);o2.connect(g);g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001,start);
      g.gain.exponentialRampToValueAtTime(0.18,start+0.01);
      g.gain.setValueAtTime(0.18,start+dur-0.02);
      g.gain.exponentialRampToValueAtTime(0.0001,start+dur);
      o1.start(start);o2.start(start);
      o1.stop(start+dur);o2.stop(start+dur);
    }
    tone(t0,0.14);
    tone(t0+0.21,0.14);
  }catch{}
}
// Tab navigation for 3-tab scan modal
function switchScanTab(tab){
  var tabs=document.querySelectorAll('.scan-tab');
  var panels=document.querySelectorAll('.scan-tab-panel');
  for(var i=0;i<tabs.length;i++){
    var t=tabs[i];
    if(t.getAttribute('data-scan-tab')===tab)t.classList.add('active');
    else t.classList.remove('active');
  }
  for(var j=0;j<panels.length;j++){
    var p=panels[j];
    if(p.getAttribute('data-scan-panel')===tab)p.classList.add('active');
    else p.classList.remove('active');
  }
}
// Render the "Letzte Erfolge" tab from sessionEntries (session successes)
function renderScanSuccesses(){
  var list=document.getElementById('scan-successes-list');
  if(!list)return;
  list.innerHTML='';
  var succ=(sessionEntries||[]).filter(function(e){return e&&e.action&&(e.batch||e.bag)});
  var cnt=document.getElementById('scan-tab-succ-count');
  if(cnt)cnt.textContent=String(succ.length);
  // Newest first
  for(var i=succ.length-1;i>=0;i--){
    var e=succ[i];
    var row=document.createElement('div');
    row.className='scan-success-row';
    if(e._tempId)row.setAttribute('data-succ-id',e._tempId);
    var tm=e.time?new Date(e.time):new Date();
    var timeStr=tm.getHours().toString().padStart(2,'0')+':'+tm.getMinutes().toString().padStart(2,'0')+':'+tm.getSeconds().toString().padStart(2,'0');
    var label=e.bag||e.batch||'';
    var locStr=e.action==='MOVE'?((e.from||'?')+' → '+(e.to||'?'))
      :e.action==='ADD'?('→ '+(e.to||''))
      :e.action==='REMOVE'?('✕ '+(e.from||''))
      :e.action==='HARVEST'?'🍄':'';
    row.innerHTML='<span class="scan-success-time">'+timeStr+'</span>'
      +'<span class="badge b-'+esc((e.action||'').toLowerCase())+'">'+esc(e.action||'')+'</span>'
      +'<span class="scan-success-body"><b>'+esc(label)+'</b>'
      +(locStr?' <span class="scan-success-loc">'+esc(locStr)+'</span>':'')+'</span>'
      +'<button class="scan-success-undo" onclick="undoSuccessRow(this)" title="Undo">↩ Undo</button>';
    list.appendChild(row);
  }
}
// Undo from "Letzte Erfolge" tab row
function undoSuccessRow(btn){
  var row=btn.closest('.scan-success-row');
  var tempId=row?row.getAttribute('data-succ-id'):null;
  if(!tempId)return;
  // Delegate to existing undoScanEntry via a matching log-entry button, or perform undo directly
  var logBtn=document.querySelector('.scan-log-entry[data-scan-id="'+tempId+'"] .sle-undo');
  if(logBtn){undoScanEntry(logBtn);renderScanSuccesses();return}
  // Fallback: mirror undoScanEntry logic for entries not in the visible log
  var idx=sessionEntries.findIndex(function(e){return e._tempId===tempId});
  if(idx===-1)return;
  var entry=sessionEntries[idx];
  var si=scanLog.findIndex(function(e){return e._tempId===tempId});if(si!==-1)scanLog.splice(si,1);
  var mi=movements.findIndex(function(e){return e._tempId===tempId});if(mi!==-1)movements.splice(mi,1);
  sessionEntries.splice(idx,1);
  if(entry._serverId)apiDelete('/api/scan-log/'+entry._serverId);
  scan.count=Math.max(0,scan.count-1);
  _scanBeep(400,100);
  setFb('info','Undo: '+entry.action+' '+(entry.bag||entry.batch));
  updateSD();renderStatus();renderScanSuccesses();
}
// Transient overlay background flash to reinforce feedback
var _scanBgFlashTimer=null;
function _flashScanBg(type){
  var ov=document.getElementById('scan-overlay');
  if(!ov)return;
  ov.classList.remove('scan-bg-ok','scan-bg-err');
  if(type==='ok')ov.classList.add('scan-bg-ok');
  else if(type==='err')ov.classList.add('scan-bg-err');
  else return;
  clearTimeout(_scanBgFlashTimer);
  _scanBgFlashTimer=setTimeout(function(){
    ov.classList.remove('scan-bg-ok','scan-bg-err');
  },800);
}
// Multi-tab scan dedup via BroadcastChannel
const scanChannel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('meister-scans'):null;
if(scanChannel){
  scanChannel.onmessage=function(ev){
    if(ev.data&&ev.data.type==='scan-entry'){
      // Add to sessionEntries for dedup checking across tabs
      sessionEntries.push(ev.data.entry);
    }
  };
}
// Duplicate detection
let _pendingDupe=null;let _pendingDupeTimer=null;
// Remove confirmation
let _pendingRemove=null;let _pendingRemoveTimer=null;

function openScanModal(){
  document.getElementById('scan-overlay').classList.add('open');
  if(window.innerWidth<=768)document.body.style.overflow='hidden';
}
function closeScanModal(){
  document.getElementById('scan-overlay').classList.remove('open');
  document.body.style.overflow='';
}
function _addLogEntry(type,msg,entryData){
  const log=document.getElementById('scan-modal-log');
  const el=document.createElement('div');
  el.className='scan-log-entry log-'+type;
  if(entryData&&entryData._tempId)el.setAttribute('data-scan-id',entryData._tempId);
  const tm=new Date();
  const timeStr=tm.getHours().toString().padStart(2,'0')+':'+tm.getMinutes().toString().padStart(2,'0')+':'+tm.getSeconds().toString().padStart(2,'0');
  if(entryData&&entryData.action&&entryData.batch){
    const sp=entryData.species||'';
    const bagLabel=entryData.bag||entryData.batch;
    const locStr=entryData.action==='MOVE'?(entryData.from+' → '+entryData.to)
      :entryData.action==='ADD'?('→ '+entryData.to)
      :entryData.action==='REMOVE'?('✕ '+(entryData.from||''))
      :entryData.action==='HARVEST'?(entryData.grams?entryData.grams+'g (Flush '+(entryData.flush||1)+')':'')
      :'';
    // Harvest entries are not undoable via the scan-log endpoint (harvests live in a separate table)
    const canUndo=entryData.action!=='HARVEST';
    el.innerHTML='<span class="sle-time">'+timeStr+'</span>'
      +'<span class="badge b-'+esc(entryData.action.toLowerCase())+'">'+esc(entryData.action)+'</span> '
      +'<span class="sle-msg"><b>'+esc(bagLabel)+'</b>'+(sp?' <span style="color:var(--c-text-muted);font-size:10px">'+esc(sp)+'</span>':'')
      +(locStr?' <span style="color:var(--c-text-muted)">'+esc(locStr)+'</span>':'')+'</span>'
      +(canUndo?'<button class="sle-undo" onclick="undoScanEntry(this)" title="Undo">↩</button>':'');
  }else{
    el.innerHTML='<span class="sle-time">'+timeStr+'</span><span class="sle-msg">'+esc(msg)+'</span>';
  }
  log.prepend(el);
  while(log.children.length>80)log.lastChild.remove();
}
let _toastTimer=null;
let _camHudToastTimer=null;
function setFb(type,msg,opts){
  const entryData=opts&&opts._tempId?opts:null;
  // When camera is active, show feedback on camera HUD instead of scan overlay
  if(_camScanner&&(!opts||!opts.noModal)){
    _showCamHudToast(type,msg);
    updateCamHud();
  }else{
    if(!opts||!opts.noModal)openScanModal();
  }
  // Always update scan overlay toast + log (for when user opens it later)
  const el=document.getElementById('scan-toast');
  el.className='scan-toast-inline fb-'+type;
  el.textContent=msg;
  requestAnimationFrame(()=>el.classList.add('visible'));
  clearTimeout(_toastTimer);
  _toastTimer=setTimeout(()=>el.classList.remove('visible'),type==='err'?4000:3000);
  if(type==='err')sessionErrors++;
  if(type==='ok'){_scanBeepOk();_flashScanBg('ok');if(typeof switchScanTab==='function')switchScanTab('current');}
  else if(type==='err'){_scanBeepErr();_flashScanBg('err');if(typeof switchScanTab==='function')switchScanTab('current');}
  _addLogEntry(type,msg,entryData);
  if(type==='ok'&&typeof renderScanSuccesses==='function')renderScanSuccesses();
}
function _showCamHudToast(type,msg){
  const el=document.getElementById('cam-hud-toast');
  el.className='cam-hud-toast ht-'+type;
  el.textContent=msg;
  requestAnimationFrame(()=>el.classList.add('visible'));
  clearTimeout(_camHudToastTimer);
  _camHudToastTimer=setTimeout(()=>el.classList.remove('visible'),type==='err'?4000:3000);
}
function updateCamHud(){
  document.getElementById('ch-action').textContent=scan.action||'—';
  document.getElementById('ch-from').textContent=scan.from||'—';
  document.getElementById('ch-to').textContent=scan.to||'—';
  document.getElementById('ch-count').textContent=scan.count;
  // Action chip color
  const actionChip=document.getElementById('cam-chip-action');
  actionChip.className='cam-chip'+(scan.action?' ch-set ch-'+scan.action.toLowerCase():'');
  // Show/hide from/arrow chips based on action
  const fromChip=document.getElementById('cam-chip-from');
  const arrowChip=document.getElementById('cam-chip-arrow');
  const toChip=document.getElementById('cam-chip-to');
  // MOVE no longer needs FROM — FROM is auto-derived per bag
  fromChip.style.display='none';
  arrowChip.style.display='none';
  toChip.className='cam-chip'+((scan.action==='ADD'||scan.action==='MOVE')&&scan.to?' ch-set':'');
  toChip.style.display=(scan.action==='ADD'||scan.action==='MOVE')?'':'none';
  const toPulse=(scan.action==='ADD'&&!scan.to)||(scan.action==='MOVE'&&!scan.to);
  toChip.classList.toggle('ch-pulse',toPulse);
  // Count chip highlight
  const countChip=document.getElementById('cam-chip-count');
  countChip.className='cam-chip'+(scan.count>0?' ch-set':'');
}
function updateSD(){
  document.getElementById('s-action').textContent=scan.action||'—';
  document.getElementById('s-from').textContent=scan.from||'—';
  document.getElementById('s-to').textContent=scan.to||'—';
  document.getElementById('s-count').textContent=scan.count;
  // Action-colored header
  const modal=document.getElementById('scan-modal');
  modal.className='scan-modal'+(scan.action?' scan-action-'+scan.action.toLowerCase():'');
  // MOVE: hide FROM chip — FROM is auto-derived per bag
  const fromChip=document.getElementById('chip-from');
  fromChip.style.display=(scan.action==='MOVE'||scan.action==='MOVE_BATCH')?'none':'';
  // Chip pulse hints
  const chipTo=document.getElementById('chip-to');
  const toPulse=(scan.action==='ADD'&&!scan.to)||(scan.action==='MOVE'&&!scan.to)||(scan.action==='MOVE_BATCH'&&!scan.to);
  chipTo.classList.toggle('chip-pulse',toPulse);
  // Last scan chip
  const lastChip=document.getElementById('chip-last');
  if(_lastScanVal){lastChip.style.display='';document.getElementById('s-last').textContent=_lastScanVal}
  // Count bump animation
  const countChip=document.getElementById('chip-count');
  countChip.classList.remove('count-bump');void countChip.offsetWidth;
  if(scan.count>0)countChip.classList.add('count-bump');
  // Session end button
  document.getElementById('btn-end-session').style.display=sessionEntries.length>0?'':'none';
  // Also sync camera HUD if it exists
  updateCamHud();
}
function resetScan(){
  scan={action:null,from:null,to:null,count:scan.count,harvestBag:null};
  document.getElementById('harvest-panel').style.display='none';
  _pendingDupe=null;_pendingRemove=null;
  clearTimeout(_pendingDupeTimer);clearTimeout(_pendingRemoveTimer);
  updateSD();setFb('info',t('scanFb.setAction'));
}
// Undo a single scan entry by clicking the ↩ button
function undoScanEntry(btn){
  const row=btn.closest('.scan-log-entry');
  const tempId=row?row.getAttribute('data-scan-id'):null;
  if(!tempId)return;
  const idx=sessionEntries.findIndex(e=>e._tempId===tempId);
  if(idx===-1)return;
  const entry=sessionEntries[idx];
  // Remove from scanLog + movements
  const si=scanLog.findIndex(e=>e._tempId===tempId);if(si!==-1)scanLog.splice(si,1);
  const mi=movements.findIndex(e=>e._tempId===tempId);if(mi!==-1)movements.splice(mi,1);
  sessionEntries.splice(idx,1);
  // Delete from server
  if(entry._serverId)apiDelete('/api/scan-log/'+entry._serverId);
  // Remove DOM row
  if(row)row.remove();
  scan.count=Math.max(0,scan.count-1);
  _scanBeep(400,100);
  setFb('info','Undo: '+entry.action+' '+(entry.bag||entry.batch));
  updateSD();renderStatus();
  if(typeof renderScanSuccesses==='function')renderScanSuccesses();
}
// Ctrl+Z undo support
let _ctrlZPending=false;let _ctrlZTimer=null;
document.addEventListener('keydown',function(e){
  if(!document.getElementById('scan-overlay').classList.contains('open'))return;
  if(e.ctrlKey&&e.key==='z'){
    e.preventDefault();
    if(sessionEntries.length===0){setFb('info','Nichts zum Rückgängig machen');return}
    if(!_ctrlZPending){
      _ctrlZPending=true;
      setFb('info','Ctrl+Z nochmal drücken zum Bestätigen');
      _ctrlZTimer=setTimeout(()=>{_ctrlZPending=false},2000);
      return;
    }
    _ctrlZPending=false;clearTimeout(_ctrlZTimer);
    // Walk backwards to find the most recent undoable entry (skip HARVEST)
    let lastUndoable=null;
    for(let i=sessionEntries.length-1;i>=0;i--){
      if(sessionEntries[i].action!=='HARVEST'){lastUndoable=sessionEntries[i];break}
    }
    if(!lastUndoable){setFb('info','Keine Scans zum Rückgängig machen');return}
    const btn=document.querySelector('[data-scan-id="'+lastUndoable._tempId+'"] .sle-undo');
    if(btn)undoScanEntry(btn);
  }
});
// End session → show summary
function endScanSession(){
  if(sessionEntries.length===0)return;
  // Summary lives in the "current" tab panel — make sure it's visible
  if(typeof switchScanTab==='function')switchScanTab('current');
  const sumEl=document.getElementById('scan-session-summary');
  // Hide log, show summary
  document.getElementById('scan-modal-log').style.display='none';
  document.getElementById('scan-toast').style.display='none';
  sumEl.style.display='block';
  const dur=sessionStartTime?Math.round((Date.now()-sessionStartTime)/60000):0;
  const startStr=sessionStartTime?new Date(sessionStartTime).toLocaleTimeString('de',{hour:'2-digit',minute:'2-digit'}):'';
  const endStr=new Date().toLocaleTimeString('de',{hour:'2-digit',minute:'2-digit'});
  // Count by action
  const counts={ADD:0,MOVE:0,REMOVE:0,HARVEST:0};
  const touchedBatches=new Map();
  sessionEntries.forEach(e=>{
    if(counts[e.action]!==undefined)counts[e.action]++;
    if(e.batch&&!touchedBatches.has(e.batch))touchedBatches.set(e.batch,e.species||'');
  });
  // Location summary
  const locSummary=[];
  if(counts.ADD>0){
    const locs={};sessionEntries.filter(e=>e.action==='ADD').forEach(e=>{locs[e.to]=(locs[e.to]||0)+1});
    Object.entries(locs).forEach(([l,n])=>locSummary.push(n+' Bags → '+esc(l)));
  }
  if(counts.MOVE>0){
    const moves={};sessionEntries.filter(e=>e.action==='MOVE').forEach(e=>{const k=esc(e.from)+' → '+esc(e.to);moves[k]=(moves[k]||0)+1});
    Object.entries(moves).forEach(([k,n])=>locSummary.push(n+' Bags '+k));
  }
  let batchHtml='';
  touchedBatches.forEach((sp,bid)=>{batchHtml+='<span>'+esc(bid)+(sp?' ('+esc(sp)+')':'')+'</span>';});
  sumEl.innerHTML='<h3>Session Zusammenfassung</h3>'
    +'<div class="scan-summary-grid">'
    +'<div class="scan-summary-stat"><div class="ss-num">'+scan.count+'</div><div class="ss-lbl">Gesamt</div></div>'
    +(counts.ADD?'<div class="scan-summary-stat" style="border-top:3px solid #86efac"><div class="ss-num">'+counts.ADD+'</div><div class="ss-lbl">ADD</div></div>':'')
    +(counts.MOVE?'<div class="scan-summary-stat" style="border-top:3px solid #93c5fd"><div class="ss-num">'+counts.MOVE+'</div><div class="ss-lbl">MOVE</div></div>':'')
    +(counts.REMOVE?'<div class="scan-summary-stat" style="border-top:3px solid #fca5a5"><div class="ss-num">'+counts.REMOVE+'</div><div class="ss-lbl">REMOVE</div></div>':'')
    +(counts.HARVEST?'<div class="scan-summary-stat" style="border-top:3px solid #fcd34d"><div class="ss-num">'+counts.HARVEST+'</div><div class="ss-lbl">HARVEST</div></div>':'')
    +(sessionErrors?'<div class="scan-summary-stat" style="border-top:3px solid #fca5a5"><div class="ss-num">'+sessionErrors+'</div><div class="ss-lbl">Fehler</div></div>':'')
    +'</div>'
    +'<div style="font-size:12px;color:var(--c-text-muted);margin-bottom:8px">Dauer: '+dur+' Min'+(startStr?' ('+startStr+' – '+endStr+')':'')+'</div>'
    +(batchHtml?'<div class="scan-summary-batches">Batches: '+batchHtml+'</div>':'')
    +(locSummary.length?'<div style="font-size:12px;margin-bottom:12px">'+locSummary.join(' · ')+'</div>':'')
    +'<div class="scan-summary-actions">'
    +'<button class="btn-xs" onclick="closeScanSession()">Schließen</button>'
    +'<button class="btn-xs green" onclick="newScanSession()">Neue Session</button>'
    +'</div>';
}
function closeScanSession(){
  document.getElementById('scan-session-summary').style.display='none';
  document.getElementById('scan-modal-log').style.display='';
  document.getElementById('scan-toast').style.display='';
  closeScanModal();
}
function newScanSession(){
  document.getElementById('scan-session-summary').style.display='none';
  document.getElementById('scan-modal-log').style.display='';
  document.getElementById('scan-toast').style.display='';
  document.getElementById('scan-modal-log').innerHTML='';
  sessionEntries=[];sessionStartTime=null;sessionErrors=0;_lastScanVal=null;
  scan.count=0;
  if(typeof renderScanSuccesses==='function')renderScanSuccesses();
  resetScan();
}
let _scanTempIdCounter=0;
function processScan(raw){
  // Underscore/hyphen convention:
  // - Location barcodes use UNDERSCORES (e.g. INC_BUERO_01, SPAWN_R1) — kept as-is
  // - Action commands use UNDERSCORES — kept as-is
  // - Bag/batch IDs use HYPHENS internally (e.g. BLUES-260327-01-06)
  // German HID barcode scanners send underscores for hyphens, so we convert
  // only for non-location, non-action values. Adding new location formats that
  // use hyphens would break this logic — always use underscores for locations.
  let val=raw.trim().toUpperCase();if(!val)return;

  // ── Numeric barcode lookup (new system: 7+ digit numbers) ──
  const numVal=parseInt(val,10);
  if(/^\d{7,}$/.test(val)&&numVal>=1000000){
    const entry=barcodeRegistry.get(numVal);
    if(!entry){setFb('err','Unbekannter Barcode: '+val);return}
    if(entry.type==='bag'){
      val=entry.id; // e.g. "SHI-260327-01-06"
      setFb('info',t('scanFb.matched',{val:val,batch:val.split('-').slice(0,-1).join('-')}));
    }else if(entry.type==='culture'){
      val=entry.id; // e.g. "MC-SHI-260327-01"
    }else if(entry.type==='zone'||entry.type==='rack'){
      val=entry.id; // e.g. "INC" or "INC_R1"
    }else if(entry.type==='asset'){
      setFb('info','Asset: '+entry.id);return;
    }
  }else{
    // ── Legacy barcode fallback ──
    if(ACTIONS.includes(val)||LOCS.includes(val)){/* keep underscores */}
    else{val=val.replace(/_/g,'-')} // German HID keyboard fix for bag IDs
    // Decode barcode → full bag ID.
    // Current format: KUERZEL_MMDD_N → 3 parts after underscore→hyphen conversion.
    // Legacy format:  SP_ST_MMDD_N  → 4 parts (old hardcoded spAbbrev + strain prefix).
    const parts=val.split('-');
    let matchBatch=null,scannedBag='';
    if(parts.length===3&&/^\d{4}$/.test(parts[1])&&/^\d{1,2}$/.test(parts[2])){
      const scannedKz=parts[0];
      const scannedMmdd=parts[1];
      scannedBag=parts[2].padStart(2,'0');
      matchBatch=batches.find(b=>{
        const bKz=(b.strainKuerzel||b.strain||'').toUpperCase();
        const bDateParts=b.batchId.split('-');
        const bMmdd=bDateParts[1]?bDateParts[1].slice(2,4)+bDateParts[1].slice(0,2):'';
        return bKz===scannedKz && bMmdd===scannedMmdd;
      });
    }else if(parts.length===4&&/^\d{4}$/.test(parts[2])&&/^\d{1,2}$/.test(parts[3])){
      const scannedSp=parts[0];
      const scannedSt=parts[1];
      const scannedMmdd=parts[2];
      scannedBag=parts[3].padStart(2,'0');
      matchBatch=batches.find(b=>{
        const bSp=spAbbrev(b.species);
        const bSt=(b.strain||'000').slice(0,3).toUpperCase();
        const bDateParts=b.batchId.split('-');
        const bMmdd=bDateParts[1]?bDateParts[1].slice(2,4)+bDateParts[1].slice(0,2):'';
        return bSp===scannedSp && bSt===scannedSt && bMmdd===scannedMmdd;
      });
    }
    if(parts.length===3&&/^\d{4}$/.test(parts[1])&&/^\d{1,2}$/.test(parts[2]) || parts.length===4&&/^\d{4}$/.test(parts[2])&&/^\d{1,2}$/.test(parts[3])){
      if(matchBatch){
        val=matchBatch.batchId+'-'+scannedBag;
        setFb('info',t('scanFb.matched',{val:val,batch:matchBatch.batchId}));
      }else{
        setFb('err',t('scanFb.noBatchFound',{val:val}));
        return;
      }
    }
  }
  if(ACTIONS.includes(val)){
    const keepTo=(val===scan.action&&scan.to);scan.action=val;scan.from=null;scan.to=keepTo?scan.to:null;scan.harvestBag=null;
    document.getElementById('harvest-panel').style.display='none';
    _pendingDupe=null;_pendingRemove=null;
    clearTimeout(_pendingDupeTimer);clearTimeout(_pendingRemoveTimer);
    updateSD();
    setFb('ok',{ADD:t('scanFb.actionAdd'),MOVE:t('scanFb.actionMove'),MOVE_BATCH:'MOVE BATCH — Ziel scannen',REMOVE:t('scanFb.actionRemove'),HARVEST:t('scanFb.actionHarvest')}[val]);return;
  }
  if(LOCS.includes(val)){
    // Warn if scanning a zone that has racks — suggest using a rack instead
    const zoneObj=zones.find(z=>z.id===val);
    const isZoneWithRacks=zoneObj&&zoneObj.racks.length>0;
    if(scan.action==='ADD'){scan.to=val;updateSD();setFb(isZoneWithRacks?'warn':'ok',isZoneWithRacks?t('scanFb.preferRack',{loc:val,example:zoneObj.racks[0].id}):t('scanFb.location',{loc:val}));return}
    if((scan.action==='MOVE'||scan.action==='MOVE_BATCH')&&!scan.to){scan.to=val;updateSD();setFb(isZoneWithRacks?'warn':'ok',isZoneWithRacks?t('scanFb.preferRack',{loc:val,example:zoneObj.racks[0].id}):t('scanFb.to',{loc:val}));return}
    // No action set? Auto-set to MOVE with this location as destination
    if(!scan.action){scan.action='MOVE';scan.to=val;scan.from=null;scan.harvestBag=null;_pendingDupe=null;_pendingRemove=null;clearTimeout(_pendingDupeTimer);clearTimeout(_pendingRemoveTimer);updateSD();setFb(isZoneWithRacks?'warn':'ok',isZoneWithRacks?t('scanFb.preferRack',{loc:val,example:zoneObj.racks[0].id}):'MOVE → '+val+' — jetzt Bags scannen');return}
    setFb('err',t('scanFb.setAction'));return;
  }
  // Culture ID scan → open lineage
  if(/^(MC|PD|LC)-[A-Z0-9]+-\d{6}-\d{2}$/.test(val)){
    const c=cultures.find(x=>x.id.toUpperCase()===val);
    if(c){closeCamScan();go('lab','n-lab');openStab('lab','lineage');setTimeout(()=>{document.getElementById('lineage-sel').value='C:'+c.id;renderLineage()},100);setFb('ok',t('scanFb.cultureScanned',{val:val}));return}
  }
  const isBag=/-\d{2}$/.test(val);
  const batchId=isBag?val.split('-').slice(0,-1).join('-'):val;
  const batch=batches.find(b=>b.batchId.toUpperCase()===batchId.toUpperCase());
  if(batch||isBag){
    if(!scan.action){openBagInfo(val,batchId,batch);return}
    if(scan.action==='HARVEST'){showHarvestPanel(isBag?val:batchId,batchId);return}
    if(scan.action==='ADD'&&!scan.to){setFb('err',t('scanFb.scanLocFirst'));return}
    if((scan.action==='MOVE'||scan.action==='MOVE_BATCH')&&!scan.to){setFb('err',t('scanFb.scanToFirst'));return}
    // MOVE_BATCH: scan any bag or batch ID → move entire batch
    if(scan.action==='MOVE_BATCH'&&batch){
      moveBatchTo(batch,scan.to,function(moved,skipped){
        if(!moved){_scanBeep(500,120);setFb('err','Batch '+batch.batchId+': keine Bags zum Verschieben'+(skipped?' ('+skipped+' bereits in '+scan.to+')':''));updateSD();return}
        setFb('ok','MOVE BATCH '+batch.batchId+': '+moved+' Bags → '+scan.to+(skipped?' ('+skipped+' übersprungen)':''));
        scan.count+=moved;updateSD();
      });
      return;
    }
    // MOVE: auto-derive FROM from bag's last known location
    if(scan.action==='MOVE'){
      const bagLast=[...scanLog].reverse().find(e=>(e.bag||'').toUpperCase()===val.toUpperCase()&&(e.action==='ADD'||e.action==='MOVE'||e.action==='REMOVE'));
      if(!bagLast){_scanBeep(300,150);setFb('err',t('scanFb.bagNotPlaced',{bag:val}));return}
      if(bagLast.action==='REMOVE'){_scanBeep(300,150);setFb('err',t('scanFb.bagRemoved',{bag:val}));return}
      const curLoc=bagLast.to||null;
      if(curLoc&&curLoc.toUpperCase()===scan.to.toUpperCase()){_scanBeep(500,120);setFb('err',t('scanFb.bagAlreadyAt',{bag:val,loc:scan.to}));return}
      scan.from=curLoc;
    }
    // REMOVE: auto-derive FROM from bag's last known location
    if(scan.action==='REMOVE'){
      const bagLastR=[...scanLog].reverse().find(e=>(e.bag||'').toUpperCase()===val.toUpperCase()&&(e.action==='ADD'||e.action==='MOVE'));
      scan.from=bagLastR?bagLastR.to:null;
    }
    // REMOVE confirmation: require scanning same bag twice within 5s
    if(scan.action==='REMOVE'){
      if(_pendingRemove&&_pendingRemove.val===val){
        clearTimeout(_pendingRemoveTimer);_pendingRemove=null;
        // Confirmed — fall through to log it
      }else{
        _pendingRemove={val};
        clearTimeout(_pendingRemoveTimer);
        _pendingRemoveTimer=setTimeout(()=>{_pendingRemove=null},5000);
        _scanBeep(300,150);
        setFb('err','REMOVE '+val+'? Nochmal scannen zum Bestätigen.');
        return;
      }
    }
    // Duplicate detection: warn if same bag+action+to already in session
    const dupeKey=val+'|'+scan.action+'|'+scan.to;
    if(scan.action!=='REMOVE'){
      const hasDupe=sessionEntries.some(e=>(e.bag||e.batch)+'|'+e.action+'|'+e.to===dupeKey);
      if(hasDupe){
        if(_pendingDupe===dupeKey){
          clearTimeout(_pendingDupeTimer);_pendingDupe=null;
          // Confirmed duplicate — fall through
        }else{
          _pendingDupe=dupeKey;
          clearTimeout(_pendingDupeTimer);
          _pendingDupeTimer=setTimeout(()=>{_pendingDupe=null},3000);
          _scanBeep(500,120);
          setFb('err',val+' bereits gescannt als '+scan.action+(scan.to?' → '+scan.to:'')+'. Nochmal scannen zum Bestätigen.');
          return;
        }
      }
    }
    const tempId='s'+(++_scanTempIdCounter);
    const entry={time:new Date().toISOString(),action:scan.action,batch:batchId,bag:isBag?val:null,from:scan.from,to:scan.to,species:batch?.species,strain:batch?.strain,user:currentUser?.username||null,_tempId:tempId};
    scanLog.push(entry);movements.push(entry);
    if(!sessionStartTime)sessionStartTime=Date.now();
    sessionEntries.push(entry);
    if(scanChannel)scanChannel.postMessage({type:'scan-entry',entry:{bag:entry.bag,batch:entry.batch,action:entry.action,to:entry.to}});
    scan.count++;
    apiPost('/api/scan-log',{entries:[entry]}).then(function(r){
      if(r&&r.ids&&r.ids[0]){entry._serverId=r.ids[0];return}
      if(r&&r.error){
        // Retry once after 3s on server error
        console.warn('Scan log POST failed, retrying:',r.error);
        setTimeout(function(){
          apiPost('/api/scan-log',{entries:[entry]}).then(function(r2){
            if(r2&&r2.ids&&r2.ids[0])entry._serverId=r2.ids[0];
            else if(r2&&r2.error)setFb('err','Scan gespeichert lokal, Server-Sync fehlgeschlagen: '+r2.error);
          });
        },3000);
      }
    });
    _lastScanVal=isBag?val:batchId;
    const fbTo=scan.action==='MOVE'&&scan.from?' '+scan.from+' \u2192 '+scan.to:scan.to?' \u2192 '+scan.to:'';
    setFb('ok',t('scanFb.logged',{action:scan.action,val:val,to:fbTo,n:scan.count}),entry);
    updateSD();return;
  }
  // URL QR codes: inform user instead of showing "unknown"
  if(/^https?:\/\//i.test(raw.trim())){
    setFb('info','QR-Code enthält URL: '+raw.trim().slice(0,80)+(raw.trim().length>80?'…':''));
    return;
  }
  setFb('err',t('scanFb.unknown',{val:val}));
}
// ─── GLOBAL BARCODE BUFFER (timing-based scanner detection) ──
const _scanBuf={chars:[],timer:null};
const SCAN_MAX_GAP=50;
const SCAN_MIN_LEN=3;

function isKnownBarcode(val){
  val=val.toUpperCase();
  // Numeric barcode (new system)
  if(/^\d{7,}$/.test(val)&&parseInt(val,10)>=1000000)return true;
  // Check actions/locations with underscores intact (barcode locations use underscores)
  if(ACTIONS.includes(val))return true;
  if(LOCS.includes(val))return true;
  // For bag/batch patterns, convert underscores to hyphens
  const h=val.replace(/_/g,'-');
  if(/^[A-Z]{2,6}-[A-Z]{2,6}-\d{4}-\d{1,2}$/.test(h))return true;
  if(/^(MC|PD|LC)-[A-Z]+-\d{6}-\d{2}$/.test(h))return true;
  if(/^[A-Z]+-\d{6}-\d{2}-\d{2}$/.test(h))return true;
  if(/^[A-Z]+-\d{6}-\d{2}$/.test(h))return true;
  return false;
}

function _flushScanBuf(){
  const raw=_scanBuf.chars.map(c=>c.ch).join('');
  _scanBuf.chars=[];
  if(raw.length<SCAN_MIN_LEN)return;
  const cleaned=raw.trim().toUpperCase();
  if(!isKnownBarcode(cleaned)){setFb('err',t('scanFb.unknownFormat',{val:cleaned})||'Unbekanntes Format: '+cleaned+' — Barcode prüfen.');return}
  processScan(raw);
}

document.addEventListener('keydown',e=>{
  if(e.ctrlKey||e.metaKey||e.altKey)return;
  // Ignore keystrokes while user is typing in form fields — prevents the scan buffer
  // from swallowing Enter on form submits or mis-firing on fast typing in search boxes.
  // The scan modal and camera modal are exceptions: keep the buffer active there.
  const ae=document.activeElement;
  if(ae&&(ae.tagName==='INPUT'||ae.tagName==='TEXTAREA'||ae.tagName==='SELECT'||ae.isContentEditable)){
    const scanOpen=document.getElementById('scan-overlay')?.classList.contains('open');
    const camOpen=document.getElementById('m-camscan')?.classList.contains('open');
    if(!scanOpen&&!camOpen){_scanBuf.chars=[];clearTimeout(_scanBuf.timer);return}
  }
  const now=performance.now();
  if(e.key==='Enter'){
    if(_scanBuf.chars.length>=SCAN_MIN_LEN){
      clearTimeout(_scanBuf.timer);
      const allFast=_scanBuf.chars.every((c,i)=>i===0||c.t-_scanBuf.chars[i-1].t<SCAN_MAX_GAP);
      if(allFast){
        e.preventDefault();e.stopPropagation();
        _flushScanBuf();return;
      }
    }
    _scanBuf.chars=[];clearTimeout(_scanBuf.timer);return;
  }
  if(e.key.length!==1)return;
  if(_scanBuf.chars.length>0&&now-_scanBuf.chars[_scanBuf.chars.length-1].t>SCAN_MAX_GAP){
    _scanBuf.chars=[];
  }
  _scanBuf.chars.push({ch:e.key,t:now});
  clearTimeout(_scanBuf.timer);
  _scanBuf.timer=setTimeout(()=>{_scanBuf.chars=[]},SCAN_MAX_GAP*2);
});

// ─── USER MANAGEMENT ─────────────────────────────────────────
async function doLogout(){
  try{await authFetch('/api/auth/logout',{method:'POST'});}catch{}
  window.location.href='/login.html';
}

async function loadUsersTab(){
  const c=document.getElementById('sp-settings-users');
  if(!c)return;
  const acct=document.getElementById('users-account');
  if(acct&&currentUser)acct.innerHTML=`Logged in as <b>${esc(currentUser.username)}</b> (${esc(currentUser.role)}) <button class="btn" style="font-size:11px;padding:2px 8px;margin-left:8px" onclick="showChangePasswordModal()">Change Password</button>`;
  if(!currentUser||currentUser.role!=='admin'){
    const tbl=document.getElementById('users-table');
    if(tbl)tbl.innerHTML='<p style="color:var(--c-text-muted)">Admin access required to manage users.</p>';
    return;
  }
  try{
    const r=await authFetch('/api/users');
    const users=await r.json();
    const tbl=document.getElementById('users-table');
    if(!tbl)return;
    tbl.innerHTML='<table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left;padding:6px;border-bottom:1px solid var(--c-border)">Username</th><th style="text-align:left;padding:6px;border-bottom:1px solid var(--c-border)">Role</th><th style="text-align:left;padding:6px;border-bottom:1px solid var(--c-border)">Created</th><th style="padding:6px;border-bottom:1px solid var(--c-border)"></th></tr></thead><tbody>'+
      users.map(u=>`<tr><td style="padding:6px">${esc(u.username)}</td><td style="padding:6px">${esc(u.role)}</td><td style="padding:6px">${u.created?fmtDt(u.created):''}</td><td style="padding:6px">${u.username!==currentUser.username?`<button class="btn btn-r" style="font-size:11px;padding:2px 8px" onclick="deleteUser(${u.id})">Delete</button>`:''}</td></tr>`).join('')+
      '</tbody></table>';
  }catch(e){console.error('Failed to load users:',e)}
}

async function addUser(){
  const u=document.getElementById('new-username').value.trim();
  const p=document.getElementById('new-password').value;
  const role=document.getElementById('new-role').value;
  if(!u||!p){alert('Username and password required');return;}
  if(p.length<8){alert('Password must be at least 8 characters');return;}
  try{
    const r=await authFetch('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p,role})});
    if(!r.ok){const d=await r.json();alert(d.error||'Failed');return;}
    document.getElementById('new-username').value='';
    document.getElementById('new-password').value='';
    loadUsersTab();
  }catch(e){alert(e.message)}
}

async function deleteUser(id){
  if(!confirm('Delete this user?'))return;
  try{
    const r=await authFetch('/api/users/'+id,{method:'DELETE'});
    if(!r.ok){const d=await r.json();alert(d.error||'Failed');return;}
    loadUsersTab();
  }catch(e){alert(e.message)}
}

function showChangePasswordModal(){
  const m=document.getElementById('change-pw-modal');
  if(m){m.style.display='flex';document.getElementById('chpw-current').value='';document.getElementById('chpw-new').value='';document.getElementById('chpw-status').textContent='';}
}
function hideChangePasswordModal(){
  const m=document.getElementById('change-pw-modal');if(m)m.style.display='none';
}
async function submitChangePassword(){
  const cur=document.getElementById('chpw-current').value;
  const nw=document.getElementById('chpw-new').value;
  const st=document.getElementById('chpw-status');
  if(!cur||!nw){st.textContent='Both fields are required.';st.style.color='red';return}
  if(nw.length<8){st.textContent='New password must be at least 8 characters.';st.style.color='red';return}
  try{
    const r=await authFetch('/api/auth/password',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword:cur,newPassword:nw})});
    if(!r.ok){const d=await r.json().catch(()=>({}));st.textContent=d.error||'Failed';st.style.color='red';return}
    st.textContent='Password changed successfully.';st.style.color='green';
    setTimeout(()=>hideChangePasswordModal(),1500);
  }catch(e){st.textContent='Error: '+e.message;st.style.color='red'}
}

// ─── INIT ────────────────────────────────────────────────────
// Set initial language
const savedLang = localStorage.getItem('mp-lang');
if (savedLang && LANG[savedLang]) currentLang = savedLang;
document.getElementById('lang-sel').value = currentLang;
translatePage();

// ─── CALENDAR ───────────────────────────────────────────────
if(typeof calendarEvents==='undefined') var calendarEvents=[];
if(typeof MS_PER_DAY==='undefined') var MS_PER_DAY=86400000;
let calYear=new Date().getFullYear(),calMonth=new Date().getMonth(),calView='month';
let calSelectedDate=new Date(),caldavImports=[];
function calDays(){return (t('cal.days')||'Mo,Di,Mi,Do,Fr,Sa,So').split(',')}
function calMonths(){return (t('cal.months')||'Januar,Februar,März,April,Mai,Juni,Juli,August,September,Oktober,November,Dezember').split(',')}
const CAL_HOURS_START=6,CAL_HOURS_END=22;

function fmtDate(y,m,d){return y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0')}
function localDateStr(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function parseDateStr(s){const p=s.split('-');return new Date(+p[0],+p[1]-1,+p[2])}

function getBatchLoc(b){
  const locs={};
  b.bags.forEach(bag=>{const last=[...scanLog].reverse().find(e=>(e.bag||'').toUpperCase()===bag.toUpperCase());if(last&&last.action!=='REMOVE'&&last.to)locs[last.to]=(locs[last.to]||0)+1});
  const entries=Object.entries(locs);if(!entries.length)return'';entries.sort((a,b)=>b[1]-a[1]);return entries[0][0];
}
function getCalendarRange(){
  // Window for expanding recurring events — covers any visible view with margin
  const y=calYear,m=calMonth;
  const start=new Date(y,m-2,1);
  const end=new Date(y,m+3,0);
  return {start,end};
}
function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x}
function addMonths(d,n){const x=new Date(d);x.setMonth(x.getMonth()+n);return x}
function expandRecurringEvent(ev){
  const out=[];
  if(!ev.recurrence){out.push(ev.startDate);return out}
  const {start:winStart,end:winEnd}=getCalendarRange();
  const base=parseDateStr(ev.startDate);
  const hardEnd=ev.recurrenceUntil?parseDateStr(ev.recurrenceUntil):null;
  let cur=new Date(base);
  let guard=0;
  while(guard++<500){
    if(hardEnd&&cur>hardEnd)break;
    if(cur>winEnd)break;
    if(cur>=winStart||cur.getTime()===base.getTime()){
      out.push(localDateStr(cur));
    }
    if(ev.recurrence==='daily')cur=addDays(cur,1);
    else if(ev.recurrence==='weekly')cur=addDays(cur,7);
    else if(ev.recurrence==='monthly')cur=addMonths(cur,1);
    else break;
  }
  return out;
}
function expandRecurringTaskDates(task){
  const out=[];
  const startStr=task.dueDate?task.dueDate.split('T')[0]:null;
  if(!startStr)return out;
  if(!task.recurrence){out.push(startStr);return out}
  const {start:winStart,end:winEnd}=getCalendarRange();
  const base=parseDateStr(startStr);
  const hardEnd=task.recurrenceUntil?parseDateStr(task.recurrenceUntil):null;
  let cur=new Date(base);
  let guard=0;
  while(guard++<500){
    if(hardEnd&&cur>hardEnd)break;
    if(cur>winEnd)break;
    if(cur>=winStart||cur.getTime()===base.getTime()){
      out.push(localDateStr(cur));
    }
    if(task.recurrence==='daily')cur=addDays(cur,1);
    else if(task.recurrence==='weekly')cur=addDays(cur,7);
    else if(task.recurrence==='monthly')cur=addMonths(cur,1);
    else break;
  }
  return out;
}
function collectCalendarEvents(){
  const events=[];
  batches.forEach(b=>{
    if(!b.due)return;
    const d=new Date(b.due);
    const loc=getBatchLoc(b);
    events.push({date:localDateStr(d),label:b.batchId+(loc?' — '+loc:''),type:'batch-due',id:b.batchId,draggable:true,allDay:true,color:'#ef4444',species:b.species});
  });
  manualTasks.forEach(t=>{
    if(!t.dueDate)return;
    const dates=expandRecurringTaskDates(t);
    const hasTime=!!t.dueTime;
    dates.forEach((ds,idx)=>{
      // Only the base occurrence is draggable; recurring instances are locked
      const isBase=idx===0&&ds===t.dueDate.split('T')[0];
      events.push({
        date:ds,
        label:t.text,
        type:'task-due',
        id:t.created,
        draggable:!t.done&&!t.recurrence&&isBase,
        allDay:!hasTime,
        startTime:hasTime?t.dueTime:undefined,
        endTime:hasTime?(t.dueEndTime||undefined):undefined,
        color:'#3b82f6',
        recurrence:t.recurrence||null
      });
    });
  });
  harvests.forEach(h=>{
    if(!h.time)return;
    const d=new Date(h.time);
    events.push({date:localDateStr(d),label:(h.batch||'?')+' '+h.grams+'g',type:'harvest',id:null,draggable:false,allDay:true,color:'#f59e0b',species:h.species});
  });
  const filterName=document.getElementById('cal-filter-user')?.value||'';
  calendarEvents.forEach(ev=>{
    const teamList=Array.isArray(ev.teamAssignees)?ev.teamAssignees:[];
    if(filterName&&teamList.length&&!teamList.includes(filterName))return;
    const dates=expandRecurringEvent(ev);
    const displayAssignees=teamList.map(n=>({userId:0,username:n}));
    dates.forEach(ds=>{
      events.push({date:ds,label:ev.title,type:'custom',id:ev.id,draggable:!ev.recurrence,allDay:ev.allDay,startTime:ev.startTime,endTime:ev.endTime,color:CATEGORY_COLORS[ev.category]||ev.color||'#16a34a',description:ev.description,assignees:displayAssignees,recurrence:ev.recurrence||null});
    });
  });
  caldavImports.forEach(ev=>{
    events.push({date:ev.date,label:ev.summary,type:'caldav-import',id:ev.uid,draggable:false,allDay:ev.allDay!==false,startTime:ev.startTime,endTime:ev.endTime,color:'#6366f1'});
  });
  return events;
}

function renderCalendar(){
  const title=document.getElementById('cal-title');
  if(!title)return;
  document.querySelectorAll('.cal-vbtn').forEach(b=>b.classList.remove('active'));
  const btn=document.getElementById('cv-'+calView);if(btn)btn.classList.add('active');
  if(calView==='month')renderCalMonth();
  else if(calView==='week')renderCalWeek();
  else if(calView==='day')renderCalDay();
}

function setCalView(v){calView=v;renderCalendar()}
function calToday(){calYear=new Date().getFullYear();calMonth=new Date().getMonth();calSelectedDate=new Date();renderCalendar()}

function calNav(delta){
  if(calView==='month'){calMonth+=delta;if(calMonth<0){calMonth=11;calYear--}if(calMonth>11){calMonth=0;calYear++}}
  else if(calView==='week'){calSelectedDate.setDate(calSelectedDate.getDate()+delta*7);calYear=calSelectedDate.getFullYear();calMonth=calSelectedDate.getMonth()}
  else if(calView==='day'){calSelectedDate.setDate(calSelectedDate.getDate()+delta);calYear=calSelectedDate.getFullYear();calMonth=calSelectedDate.getMonth()}
  renderCalendar();
}

function printCalendar(){
  const modal=document.getElementById('m-cal-print');
  if(!modal)return;
  modal.classList.add('open');
}
function closeCalPrintModal(){const m=document.getElementById('m-cal-print');if(m)m.classList.remove('open')}

function printCalendarTaskList(range){
  const sheet=document.getElementById('print-sheet');
  if(!sheet)return;

  const MONTHS=calMonths(),DAYS=calDays();

  // Determine date range
  let startDate,endDate,rangeLabel;
  if(range==='week'){
    startDate=getWeekStart(calSelectedDate);
    endDate=new Date(startDate);endDate.setDate(startDate.getDate()+6);
    const sameMonth=startDate.getMonth()===endDate.getMonth();
    rangeLabel=t('cal.weekShort')+': '+startDate.getDate()+'. '+(sameMonth?'':MONTHS[startDate.getMonth()]+' ')+'– '+endDate.getDate()+'. '+MONTHS[endDate.getMonth()]+' '+endDate.getFullYear();
  }else{
    startDate=new Date(calYear,calMonth,1);
    endDate=new Date(calYear,calMonth+1,0);
    rangeLabel=t('cal.monthShort')+': '+MONTHS[calMonth]+' '+calYear;
  }

  // Collect and filter events in range
  const allEvents=collectCalendarEvents();
  const startStr=fmtDate(startDate.getFullYear(),startDate.getMonth(),startDate.getDate());
  const endStr=fmtDate(endDate.getFullYear(),endDate.getMonth(),endDate.getDate());
  const eventsInRange=allEvents.filter(e=>e.date>=startStr&&e.date<=endStr);

  // Group by date
  const byDate={};
  eventsInRange.forEach(e=>{(byDate[e.date]=byDate[e.date]||[]).push(e)});

  // Type label map
  const typeLabels={
    'batch-due':t('cal.legend.batches'),
    'task-due':t('calDetail.taskDue'),
    'harvest':t('cal.legend.harvests'),
    'custom':t('calEntry.cat.custom'),
    'caldav-import':t('calDetail.external')
  };

  // Build day list
  const days=[];
  for(let d=new Date(startDate);d<=endDate;d.setDate(d.getDate()+1)){
    const ds=fmtDate(d.getFullYear(),d.getMonth(),d.getDate());
    const dayName=DAYS[(d.getDay()+6)%7];
    const dayEvents=(byDate[ds]||[]).slice().sort((a,b)=>{
      if(a.allDay&&!b.allDay)return -1;
      if(!a.allDay&&b.allDay)return 1;
      return (a.startTime||'').localeCompare(b.startTime||'');
    });
    days.push({ds,dayName,date:new Date(d),events:dayEvents});
  }

  // Render HTML
  const todayStr=localDateStr(new Date());
  let bodyHtml='';
  days.forEach(day=>{
    const isToday=day.ds===todayStr;
    bodyHtml+='<div class="cal-print-day'+(isToday?' today':'')+'">';
    bodyHtml+='<div class="cal-print-day-hdr">'+day.dayName+', '+day.date.getDate()+'. '+MONTHS[day.date.getMonth()]+' '+day.date.getFullYear()+'</div>';
    if(day.events.length===0){
      bodyHtml+='<div class="cal-print-empty">— '+t('cal.noTasks')+' —</div>';
    }else{
      bodyHtml+='<ul class="cal-print-list">';
      day.events.forEach(e=>{
        const time=e.allDay?t('cal.allDay'):((e.startTime||'')+(e.endTime?' – '+e.endTime:''));
        const typeLbl=typeLabels[e.type]||'';
        const dotColor=safeColor(e.color||'#64748b');
        const assigneeStr=e.assignees&&e.assignees.length?' <span class="cal-print-assignees">('+e.assignees.map(a=>esc(a.username)).join(', ')+')</span>':'';
        const desc=e.description?'<div class="cal-print-desc">'+esc(e.description)+'</div>':'';
        bodyHtml+='<li class="cal-print-item">'+
          '<span class="cal-print-dot" style="background:'+dotColor+'"></span>'+
          '<span class="cal-print-time">'+esc(time)+'</span>'+
          '<span class="cal-print-type">'+typeLbl+'</span>'+
          '<span class="cal-print-label">'+esc(e.label)+assigneeStr+desc+'</span>'+
        '</li>';
      });
      bodyHtml+='</ul>';
    }
    bodyHtml+='</div>';
  });

  const totalEvents=eventsInRange.length;
  sheet.innerHTML='<div class="cal-print-page cal-print-tasklist">'+
    '<div class="cal-print-header">'+
      '<div style="font-size:20px;font-weight:800;color:#111">'+esc(t('cal.taskListTitle'))+'</div>'+
      '<div style="font-size:13px;color:#444;margin-top:2px">'+esc(rangeLabel)+'</div>'+
      '<div style="font-size:11px;color:#666;margin-top:2px">'+totalEvents+' '+t('cal.entries')+' — '+t('cal.printed')+' '+new Date().toLocaleDateString(loc())+'</div>'+
    '</div>'+
    '<div class="cal-print-body">'+bodyHtml+'</div>'+
  '</div>';

  closeCalPrintModal();
  setTimeout(()=>window.print(),150);
}

// ── Month View ──
function renderCalMonth(){
  const container=document.getElementById('cal-container');
  const title=document.getElementById('cal-title');
  const months=calMonths(),days2=calDays();
  title.textContent=months[calMonth]+' '+calYear;
  const firstDay=new Date(calYear,calMonth,1);
  const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
  let startDow=(firstDay.getDay()+6)%7;
  const prevLast=new Date(calYear,calMonth,0).getDate();
  const events=collectCalendarEvents();
  const todayStr=localDateStr(new Date());
  const totalCells=startDow+daysInMonth;
  const rows=Math.max(6,Math.ceil(totalCells/7));
  const trailing=rows*7-totalCells;

  let html='<div class="cal-grid" id="cal-grid">';
  html+=days2.map(d=>'<div class="cal-hdr">'+d+'</div>').join('');

  function eventsForDate(ds){
    const de=events.filter(e=>e.date===ds);
    const mx=3;
    let o=de.slice(0,mx).map(e=>{
      const drag=e.draggable?'draggable="true"':'';
      const cls=e.draggable?'cal-event':'cal-event no-drag';
      const bg=e.color?'style="background:'+safeColor(e.color)+'"':'';
      const assigneeStr=e.assignees&&e.assignees.length?' <span class="cal-ev-assignees">'+e.assignees.map(a=>esc(a.username)).join(', ')+'</span>':'';
      const dot=e.species?spDot(e.species):'';
      return'<div class="'+cls+'" '+drag+' data-type="'+esc(e.type)+'" data-id="'+esc(e.id||'')+'" title="'+esc(e.label)+'" '+bg+'>'+dot+esc(e.label)+assigneeStr+'</div>';
    }).join('');
    if(de.length>mx)o+='<div class="cal-more">+'+(de.length-mx)+' '+t('cal.more')+'</div>';
    return o;
  }

  for(let i=startDow-1;i>=0;i--){
    const day=prevLast-i,m=calMonth===0?11:calMonth-1,y=calMonth===0?calYear-1:calYear,ds=fmtDate(y,m,day);
    html+='<div class="cal-cell other" data-date="'+ds+'" onclick="calCellClick(event,\''+ds+'\')"><div class="cal-day" onclick="event.stopPropagation();calGotoDay(\''+ds+'\')">'+day+'</div>'+eventsForDate(ds)+'</div>';
  }
  for(let d=1;d<=daysInMonth;d++){
    const ds=fmtDate(calYear,calMonth,d),cls=ds===todayStr?'cal-cell today':'cal-cell';
    html+='<div class="'+cls+'" data-date="'+ds+'" onclick="calCellClick(event,\''+ds+'\')"><div class="cal-day" onclick="event.stopPropagation();calGotoDay(\''+ds+'\')">'+d+'</div>'+eventsForDate(ds)+'</div>';
  }
  for(let d=1;d<=trailing;d++){
    const m=calMonth===11?0:calMonth+1,y=calMonth===11?calYear+1:calYear,ds=fmtDate(y,m,d);
    html+='<div class="cal-cell other" data-date="'+ds+'" onclick="calCellClick(event,\''+ds+'\')"><div class="cal-day" onclick="event.stopPropagation();calGotoDay(\''+ds+'\')">'+d+'</div>'+eventsForDate(ds)+'</div>';
  }
  html+='</div>';
  container.innerHTML=html;
  initCalDragDrop(container);
}
function calCellClick(e,ds){if(e.target.closest('.cal-event')||e.target.closest('.cal-more'))return;openEventModal(ds)}
function calGotoDay(ds){calSelectedDate=parseDateStr(ds);calYear=calSelectedDate.getFullYear();calMonth=calSelectedDate.getMonth();setCalView('day')}

// ── Week View ──
function getWeekStart(d){const dt=new Date(d);const dow=(dt.getDay()+6)%7;dt.setDate(dt.getDate()-dow);dt.setHours(0,0,0,0);return dt}

function renderCalWeek(){
  const container=document.getElementById('cal-container');
  const title=document.getElementById('cal-title');
  const ws=getWeekStart(calSelectedDate);
  const days=[];
  for(let i=0;i<7;i++){const d=new Date(ws);d.setDate(ws.getDate()+i);days.push(d)}
  const todayStr=localDateStr(new Date());
  const MONTHS=calMonths(),DAYS=calDays();
  title.textContent=days[0].getDate()+'. '+(days[0].getMonth()!==days[6].getMonth()?MONTHS[days[0].getMonth()]+' — '+days[6].getDate()+'. '+MONTHS[days[6].getMonth()]:' — '+days[6].getDate()+'. '+MONTHS[days[0].getMonth()])+' '+days[6].getFullYear();
  const events=collectCalendarEvents();
  const dayStrs=days.map(d=>localDateStr(d));

  let html='<div class="cal-week">';
  html+='<div class="cal-week-hdr"><div class="cal-week-hdr-cell"></div>';
  days.forEach((d,i)=>{const ds=dayStrs[i];html+='<div class="cal-week-hdr-cell'+(ds===todayStr?' today-col':'')+'" onclick="calGotoDay(\''+ds+'\')">'+DAYS[i]+'<span class="wk-day-num">'+d.getDate()+'</span></div>'});
  html+='</div>';
  html+='<div class="cal-week-allday"><div class="cal-week-allday-label">'+t('cal.allDayShort')+'</div>';
  days.forEach((d,i)=>{
    const ds=dayStrs[i];
    const de=events.filter(e=>e.date===ds&&e.allDay);
    html+='<div class="cal-week-allday-cell" data-date="'+ds+'">';
    de.forEach(e=>{
      const cls=e.draggable?'cal-event':'cal-event no-drag';
      const bg=e.color?'style="background:'+safeColor(e.color)+'"':'';
      const dot=e.species?spDot(e.species):'';
      html+='<div class="'+cls+'" '+(e.draggable?'draggable="true"':'')+' data-type="'+esc(e.type)+'" data-id="'+esc(e.id||'')+'" title="'+esc(e.label)+'" '+bg+'>'+dot+esc(e.label)+'</div>';
    });
    html+='</div>';
  });
  html+='</div>';
  html+='<div class="cal-week-body">';
  for(let h=CAL_HOURS_START;h<=CAL_HOURS_END;h++){
    html+='<div class="cal-week-time">'+String(h).padStart(2,'0')+':00</div>';
    days.forEach((d,i)=>{
      const ds=dayStrs[i];
      html+='<div class="cal-week-slot'+(ds===todayStr?' today-col':'')+'" data-date="'+ds+'" data-hour="'+h+'" onclick="openEventModal(\''+ds+'\',\''+String(h).padStart(2,'0')+':00\')"></div>';
    });
  }
  html+='</div></div>';
  container.innerHTML=html;

  const body=container.querySelector('.cal-week-body');
  if(body){
    days.forEach((d,i)=>{
      const ds=dayStrs[i];
      const timed=events.filter(e=>e.date===ds&&!e.allDay&&e.startTime);
      timed.forEach(e=>{
        const[sh,sm]=(e.startTime||'09:00').split(':').map(Number);
        const[eh,em]=(e.endTime||String(sh+1).padStart(2,'0')+':00').split(':').map(Number);
        const top=((sh-CAL_HOURS_START)*48)+(sm/60*48);
        const height=Math.max(24,((eh-sh)*48)+((em-sm)/60*48));
        const col=i+2;
        const el=document.createElement('div');
        el.className='cal-week-ev';
        el.style.cssText='top:'+top+'px;height:'+height+'px;background:'+safeColor(e.color)+';grid-column:'+col;
        const wkDot=e.species?spDot(e.species):'';
        let wkContent=wkDot+esc(e.label);
        if(e.assignees&&e.assignees.length)wkContent+=' <span class="cal-ev-assignees">'+e.assignees.map(a=>esc(a.username)).join(', ')+'</span>';
        if(height>=48&&e.startTime)wkContent+='<div style="opacity:.8;font-size:10px">'+e.startTime+(e.endTime?' — '+e.endTime:'')+'</div>';
        if(height>=72&&e.description)wkContent+='<div style="opacity:.7;font-size:10px;margin-top:1px">'+esc(e.description)+'</div>';
        el.innerHTML=wkContent;
        el.title=e.label;
        el.dataset.type=e.type;el.dataset.id=e.id||'';
        el.dataset.date=ds;
        el.onclick=function(){if(!el._dragged)onCalEventClick(e)};
        if(e.type==='custom'){
          const rh=document.createElement('div');rh.className='ev-resize';el.appendChild(rh);
          initEventDrag(el,body,'week',dayStrs);
          initEventResize(el,rh,body,'week');
        }
        body.appendChild(el);
      });
    });
    const now=new Date();const nowDs=localDateStr(now);
    const todayIdx=dayStrs.indexOf(nowDs);
    if(todayIdx>=0){
      const nowH=now.getHours(),nowM=now.getMinutes();
      if(nowH>=CAL_HOURS_START&&nowH<=CAL_HOURS_END){
        const top=((nowH-CAL_HOURS_START)*48)+(nowM/60*48);
        const line=document.createElement('div');
        line.className='cal-week-now-line';
        line.style.top=top+'px';
        body.appendChild(line);
        body.scrollTop=Math.max(0,top-150);
      }
    }
  }
  initCalDragDrop(container);
}

// ── Day View ──
function renderCalDay(){
  const container=document.getElementById('cal-container');
  const title=document.getElementById('cal-title');
  const d=calSelectedDate;
  const ds=localDateStr(d);
  const DAYS=calDays(),MONTHS=calMonths();
  const dayName=DAYS[(d.getDay()+6)%7];
  title.textContent=dayName+', '+d.getDate()+'. '+MONTHS[d.getMonth()]+' '+d.getFullYear();
  const events=collectCalendarEvents();
  const dayEvents=events.filter(e=>e.date===ds);
  const allDay=dayEvents.filter(e=>e.allDay);
  const timed=dayEvents.filter(e=>!e.allDay&&e.startTime);

  let html='<div class="cal-day-view">';
  html+='<div class="cal-day-allday"><div class="sec">'+t('cal.allDay')+'</div>';
  if(allDay.length){
    allDay.forEach(e=>{
      const cls=e.draggable?'cal-event':'cal-event no-drag';
      const bg=e.color?'style="background:'+safeColor(e.color)+'"':'';
      const dot=e.species?spDot(e.species):'';
      html+='<div class="'+cls+'" '+(e.draggable?'draggable="true"':'')+' data-type="'+esc(e.type)+'" data-id="'+esc(e.id||'')+'" title="'+esc(e.label)+'" '+bg+'>'+dot+esc(e.label)+'</div>';
    });
  }else{html+='<div class="cal-day-allday-empty">'+t('cal.noAllDay')+'</div>'}
  html+='</div>';
  html+='<div class="cal-day-body">';
  for(let h=CAL_HOURS_START;h<=CAL_HOURS_END;h++){
    html+='<div class="cal-day-time">'+String(h).padStart(2,'0')+':00</div>';
    html+='<div class="cal-day-slot" data-date="'+ds+'" data-hour="'+h+'" onclick="openEventModal(\''+ds+'\',\''+String(h).padStart(2,'0')+':00\')"></div>';
  }
  html+='</div></div>';
  container.innerHTML=html;

  const body=container.querySelector('.cal-day-body');
  if(body){
    timed.forEach(e=>{
      const[sh,sm]=(e.startTime||'09:00').split(':').map(Number);
      const[eh,em]=(e.endTime||String(sh+1).padStart(2,'0')+':00').split(':').map(Number);
      const top=((sh-CAL_HOURS_START)*48)+(sm/60*48);
      const height=Math.max(24,((eh-sh)*48)+((em-sm)/60*48));
      const el=document.createElement('div');
      el.className='cal-day-ev';
      el.style.cssText='top:'+top+'px;height:'+height+'px;background:'+safeColor(e.color)+';grid-column:2';
      const dayDot=e.species?spDot(e.species):'';
      let dayContent=dayDot+'<strong>'+esc(e.label)+'</strong>';
      if(e.assignees&&e.assignees.length)dayContent+=' <span class="cal-ev-assignees">'+e.assignees.map(a=>esc(a.username)).join(', ')+'</span>';
      if(e.startTime)dayContent+='<div style="opacity:.8;font-size:11px;margin-top:2px">'+e.startTime+(e.endTime?' — '+e.endTime:'')+'</div>';
      if(height>=72&&e.description)dayContent+='<div style="opacity:.7;font-size:10px;margin-top:2px">'+esc(e.description)+'</div>';
      el.innerHTML=dayContent;
      el.title=e.label;
      el.dataset.type=e.type;el.dataset.id=e.id||'';
      el.dataset.date=ds;
      el.onclick=function(){if(!el._dragged)onCalEventClick(e)};
      if(e.type==='custom'){
        const rh=document.createElement('div');rh.className='ev-resize';el.appendChild(rh);
        initEventDrag(el,body,'day',null);
        initEventResize(el,rh,body,'day');
      }
      body.appendChild(el);
    });
    const now=new Date();const nowDs=localDateStr(now);
    if(ds===nowDs){
      const nowH=now.getHours(),nowM=now.getMinutes();
      if(nowH>=CAL_HOURS_START&&nowH<=CAL_HOURS_END){
        const top=((nowH-CAL_HOURS_START)*48)+(nowM/60*48);
        const line=document.createElement('div');
        line.className='cal-day-now-line';
        line.style.top=top+'px';
        body.appendChild(line);
        body.scrollTop=Math.max(0,top-150);
      }
    }
  }
  initCalDragDrop(container);
}

// ── Calendar Drag-and-Drop ──
function initCalDragDrop(root){
  if(!root)return;
  root.onclick=function(e){
    const ev=e.target.closest('.cal-event');
    if(!ev)return;
    e.stopPropagation();
    onCalMonthEventClick(ev.dataset.type,ev.dataset.id);
  };
  root.ondragstart=function(e){
    const ev=e.target.closest('.cal-event');
    if(!ev||ev.classList.contains('no-drag')){e.preventDefault();return}
    e.dataTransfer.setData('text/plain',ev.dataset.type+'|'+ev.dataset.id);
    e.dataTransfer.effectAllowed='move';
    ev.style.opacity='0.4';
  };
  root.ondragend=function(e){
    const ev=e.target.closest('.cal-event');
    if(ev)ev.style.opacity='1';
    root.querySelectorAll('.drag-over').forEach(c=>c.classList.remove('drag-over'));
  };
  root.ondragover=function(e){
    const cell=e.target.closest('[data-date]');
    if(!cell)return;
    e.preventDefault();e.dataTransfer.dropEffect='move';
    root.querySelectorAll('.drag-over').forEach(c=>c.classList.remove('drag-over'));
    cell.classList.add('drag-over');
  };
  root.ondragleave=function(e){
    const cell=e.target.closest('[data-date]');
    if(cell)cell.classList.remove('drag-over');
  };
  root.ondrop=function(e){
    e.preventDefault();
    root.querySelectorAll('.drag-over').forEach(c=>c.classList.remove('drag-over'));
    const cell=e.target.closest('[data-date]');
    if(!cell||!cell.dataset.date)return;
    const data=e.dataTransfer.getData('text/plain');if(!data)return;
    const[type,id]=data.split('|');
    handleCalendarDrop(type,id,cell.dataset.date);
  };
}

function handleCalendarDrop(type,id,newDateStr){
  if(type==='batch-due'){
    const b=batches.find(x=>x.batchId===id);if(!b)return;
    const newDue=new Date(newDateStr+'T12:00:00');
    b.due=newDue.toISOString();
    const created=new Date(b.created);
    b.days=Math.max(1,Math.round((newDue-created)/MS_PER_DAY));
    apiPatch('/api/batches/'+encodeURIComponent(id),{due:b.due,days:b.days});
    renderCalendar();
    if(typeof pushBatchCaldav==='function')pushBatchCaldav(b);
  }else if(type==='task-due'){
    const t=manualTasks.find(x=>x.created===id);if(!t)return;
    t.dueDate=newDateStr;t.caldavSynced=null;
    apiPatch('/api/tasks/'+t.id,{dueDate:newDateStr,caldavSynced:null});
    renderCalendar();
    if(caldav.enabled&&t.caldavUid&&typeof pushTaskCaldav==='function')pushTaskCaldav(t);
  }else if(type==='custom'){
    const ev=calendarEvents.find(x=>x.id===id);if(!ev)return;
    ev.startDate=newDateStr;ev.caldavSynced=null;
    apiPatch('/api/calendar-events/'+encodeURIComponent(ev.id),{startDate:newDateStr,caldavSynced:null});
    renderCalendar();
    if(typeof pushEventCaldav==='function')pushEventCaldav(ev);
  }
}

// ── Time-based Drag & Resize for Week/Day views ──
function pxToTime(px){
  const totalMin=(px/48)*60;
  let h=CAL_HOURS_START+Math.floor(totalMin/60);
  let m=Math.round(totalMin%60/15)*15;
  if(m>=60){h++;m=0}
  h=Math.max(CAL_HOURS_START,Math.min(CAL_HOURS_END,h));
  return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
}

function snapPx(px){return Math.round(px/12)*12}

function updateEventTime(id,newStart,newEnd,newDate){
  const ev=calendarEvents.find(x=>x.id===id);if(!ev)return;
  if(newStart)ev.startTime=newStart;
  if(newEnd)ev.endTime=newEnd;
  if(newDate)ev.startDate=newDate;
  ev.caldavSynced=null;
  const patch={caldavSynced:null};
  if(newStart)patch.startTime=newStart;
  if(newEnd)patch.endTime=newEnd;
  if(newDate)patch.startDate=newDate;
  apiPatch('/api/calendar-events/'+encodeURIComponent(id),patch);
  renderCalendar();
  if(typeof pushEventCaldav==='function')pushEventCaldav(ev);
}

function initEventDrag(el,body,viewType,dayStrs){
  function startDrag(clientX,clientY){
    if(el._resizing)return;
    const startY=clientY,startX=clientX;
    const origTop=parseFloat(el.style.top);
    let dragging=false;el._dragged=false;
    const onMove=function(cx,cy){
      const dy=cy-startY;
      const dx=cx-startX;
      if(!dragging&&Math.abs(dy)<4&&Math.abs(dx)<4)return;
      dragging=true;el._dragged=true;
      el.style.top=snapPx(origTop+dy)+'px';
      el.style.opacity='0.7';el.style.zIndex='10';
      if(viewType==='week'&&dayStrs){
        const bodyRect=body.getBoundingClientRect();
        const timeColW=56;
        const colW=(bodyRect.width-timeColW)/7;
        const relX=cx-bodyRect.left-timeColW;
        const newColIdx=Math.max(0,Math.min(6,Math.floor(relX/colW)));
        el.style.gridColumn=String(newColIdx+2);
      }
    };
    const onUp=function(){
      document.removeEventListener('mousemove',mmh);
      document.removeEventListener('mouseup',muh);
      document.removeEventListener('touchmove',tmh);
      document.removeEventListener('touchend',teh);
      el.style.opacity='';el.style.zIndex='';
      if(!dragging)return;
      const newTop=Math.max(0,snapPx(parseFloat(el.style.top)));
      const evId=el.dataset.id;
      const newStart=pxToTime(newTop);
      const ce=calendarEvents.find(x=>x.id===evId);if(!ce)return;
      const[osh,osm]=(ce.startTime||'09:00').split(':').map(Number);
      const[oeh,oem]=(ce.endTime||'10:00').split(':').map(Number);
      const durMin=(oeh*60+oem)-(osh*60+osm);
      const[nsh,nsm]=newStart.split(':').map(Number);
      const endMin=nsh*60+nsm+durMin;
      const neh=Math.min(CAL_HOURS_END,Math.floor(endMin/60));
      const nem=endMin%60;
      const newEnd=String(neh).padStart(2,'0')+':'+String(nem).padStart(2,'0');
      let newDate=el.dataset.date;
      if(viewType==='week'&&dayStrs){
        const newColIdx=parseInt(el.style.gridColumn)-2;
        if(newColIdx>=0&&newColIdx<dayStrs.length)newDate=dayStrs[newColIdx];
      }
      updateEventTime(evId,newStart,newEnd,newDate);
    };
    const mmh=function(e){onMove(e.clientX,e.clientY)};
    const muh=function(){onUp()};
    const tmh=function(e){e.preventDefault();const t=e.touches[0];onMove(t.clientX,t.clientY)};
    const teh=function(){onUp()};
    document.addEventListener('mousemove',mmh);
    document.addEventListener('mouseup',muh);
    document.addEventListener('touchmove',tmh,{passive:false});
    document.addEventListener('touchend',teh);
  }
  el.addEventListener('mousedown',function(e){
    if(e.target.classList.contains('ev-resize'))return;
    e.preventDefault();startDrag(e.clientX,e.clientY);
  });
  el.addEventListener('touchstart',function(e){
    if(e.target.classList.contains('ev-resize'))return;
    const t=e.touches[0];startDrag(t.clientX,t.clientY);
  },{passive:true});
}

function initEventResize(el,handle,body,viewType){
  function startResize(clientY){
    el._resizing=true;
    const startY=clientY;
    const origHeight=parseFloat(el.style.height);
    let resizing=false;
    const onMove=function(cy){
      const dy=cy-startY;
      if(!resizing&&Math.abs(dy)<4)return;
      resizing=true;el._dragged=true;
      const newH=Math.max(12,snapPx(origHeight+dy));
      el.style.height=newH+'px';
    };
    const onUp=function(){
      document.removeEventListener('mousemove',mmh);
      document.removeEventListener('mouseup',muh);
      document.removeEventListener('touchmove',tmh);
      document.removeEventListener('touchend',teh);
      el._resizing=false;
      if(!resizing)return;
      const evId=el.dataset.id;
      const newHeight=Math.max(12,parseFloat(el.style.height));
      const topPx=parseFloat(el.style.top);
      const endPx=topPx+newHeight;
      const newEnd=pxToTime(endPx);
      const newStart=pxToTime(topPx);
      updateEventTime(evId,newStart,newEnd,null);
    };
    const mmh=function(e){onMove(e.clientY)};
    const muh=function(){onUp()};
    const tmh=function(e){e.preventDefault();onMove(e.touches[0].clientY)};
    const teh=function(){onUp()};
    document.addEventListener('mousemove',mmh);
    document.addEventListener('mouseup',muh);
    document.addEventListener('touchmove',tmh,{passive:false});
    document.addEventListener('touchend',teh);
  }
  handle.addEventListener('mousedown',function(e){e.preventDefault();e.stopPropagation();startResize(e.clientY)});
  handle.addEventListener('touchstart',function(e){e.stopPropagation();startResize(e.touches[0].clientY)},{passive:true});
}

// ── Calendar Event Click ──
function onCalEventClick(ev){
  if(ev.type==='harvest')return;
  openEventDetail(ev);
}

function openEventDetail(ev){
  const titleEl=document.getElementById('cal-detail-title');
  const metaEl=document.getElementById('cal-detail-meta');
  const badgesEl=document.getElementById('cal-detail-badges');
  const assignEl=document.getElementById('cal-detail-assignee');
  const descEl=document.getElementById('cal-detail-desc');
  const btnsEl=document.getElementById('cal-detail-btns');

  if(ev.type==='custom'){
    const ce=calendarEvents.find(x=>x.id===ev.id);if(!ce)return;
    titleEl.textContent=ce.title;
    const occDate=ev.date||ce.startDate;
    let meta=new Date(occDate).toLocaleDateString(loc(),{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    if(!ce.allDay&&ce.startTime)meta+=', '+ce.startTime+(ce.endTime?' — '+ce.endTime:'');
    if(ce.endDate&&ce.endDate!==ce.startDate)meta+=' '+t('calEntry.until')+' '+new Date(ce.endDate).toLocaleDateString(loc(),{day:'numeric',month:'long',year:'numeric'});
    metaEl.textContent=meta;
    const catLabels={custom:t('calEntry.cat.custom'),meeting:t('calEntry.cat.meeting'),delivery:t('calEntry.cat.delivery'),maintenance:t('calEntry.cat.maintenance')};
    const recLabels={daily:t('calEntry.rec.daily'),weekly:t('calEntry.rec.weekly'),monthly:t('calEntry.rec.monthly')};
    let badges='<span style="display:inline-block;font-size:11px;padding:2px 10px;border-radius:4px;font-weight:500;background:'+(CATEGORY_COLORS[ce.category]||safeColor(ce.color))+';color:#fff">'+esc(catLabels[ce.category]||ce.category)+'</span>';
    if(ce.recurrence)badges+='<span style="display:inline-block;font-size:11px;padding:2px 10px;border-radius:4px;font-weight:500;background:var(--c-text-muted);color:#fff">🔁 '+esc(recLabels[ce.recurrence]||ce.recurrence)+'</span>';
    badgesEl.innerHTML=badges;
    const teamList=Array.isArray(ce.teamAssignees)?ce.teamAssignees:[];
    assignEl.innerHTML=t('calDetail.assignedTo')+': <strong>'+(teamList.length?teamList.map(n=>esc(n)).join(', '):esc(t('calDetail.everyone')))+'</strong>';
    descEl.textContent=ce.description||'';
    descEl.style.display=ce.description?'':'none';
    btnsEl.innerHTML='<button class="btn btn-r" data-cal-action="delete-event" data-cal-id="'+esc(ce.id)+'">'+esc(t('calEntry.delete'))+'</button><span style="flex:1"></span><button class="btn" data-cal-action="close">'+esc(t('calDetail.close'))+'</button><button class="btn btn-p" data-cal-action="edit-event" data-cal-id="'+esc(ce.id)+'">'+esc(t('calDetail.edit'))+'</button>';

  }else if(ev.type==='task-due'){
    const tk=manualTasks.find(x=>x.created===ev.id);if(!tk)return;
    titleEl.textContent=tk.text;
    let meta=t('calDetail.taskDue');
    if(tk.dueDate)meta+=' — '+t('calDetail.dueLabel')+': '+new Date(tk.dueDate).toLocaleDateString(loc(),{day:'numeric',month:'long',year:'numeric'});
    if(tk.dueTime)meta+=', '+tk.dueTime+(tk.dueEndTime?' — '+tk.dueEndTime:'');
    metaEl.textContent=meta;
    const prioLabels={high:t('calEntry.prio.high'),med:t('calEntry.prio.med'),medium:t('calEntry.prio.med'),low:t('calEntry.prio.low')};
    const prioColors={high:'#ef4444',med:'#f59e0b',medium:'#f59e0b',low:'#22c55e'};
    const recLabels2={daily:t('calEntry.rec.daily'),weekly:t('calEntry.rec.weekly'),monthly:t('calEntry.rec.monthly')};
    let tBadges='<span style="display:inline-block;font-size:11px;padding:2px 10px;border-radius:4px;font-weight:500;background:var(--c-blue);color:#fff">'+esc(t('calDetail.taskDue'))+'</span>';
    if(tk.priority)tBadges+='<span style="display:inline-block;font-size:11px;padding:2px 10px;border-radius:4px;font-weight:500;background:'+(prioColors[tk.priority]||'#888')+';color:#fff">'+esc(prioLabels[tk.priority]||tk.priority)+'</span>';
    if(tk.recurrence)tBadges+='<span style="display:inline-block;font-size:11px;padding:2px 10px;border-radius:4px;font-weight:500;background:var(--c-text-muted);color:#fff">🔁 '+esc(recLabels2[tk.recurrence]||tk.recurrence)+'</span>';
    badgesEl.innerHTML=tBadges;
    const assigneeList=parseTaskAssignees(tk.assignee);
    assignEl.innerHTML=t('calDetail.assignedTo')+': <strong>'+(assigneeList.length?assigneeList.map(n=>esc(n)).join(', '):esc(t('calDetail.everyone')))+'</strong>';
    descEl.textContent=tk.description||'';
    descEl.style.display=tk.description?'':'none';
    const doneLabel=tk.done?t('calDetail.markUndone'):t('calDetail.markDone');
    btnsEl.innerHTML='<button class="btn btn-r" data-cal-action="delete-task" data-cal-id="'+esc(ev.id)+'">'+esc(t('calEntry.delete'))+'</button><button class="btn'+(tk.done?'':' btn-p')+'" data-cal-action="toggle-task" data-cal-id="'+esc(ev.id)+'">'+esc(doneLabel)+'</button><span style="flex:1"></span><button class="btn" data-cal-action="close">'+esc(t('calDetail.close'))+'</button><button class="btn btn-p" data-cal-action="edit-task" data-cal-id="'+esc(ev.id)+'">'+esc(t('calDetail.edit'))+'</button>';

  }else if(ev.type==='batch-due'){
    titleEl.textContent=ev.label;
    const b=batches.find(x=>x.batchId===ev.id);
    let meta=t('calDetail.batchDue');
    if(b&&b.due)meta+=' — '+new Date(b.due).toLocaleDateString(loc(),{day:'numeric',month:'long',year:'numeric'});
    metaEl.textContent=meta;
    badgesEl.innerHTML='<span style="display:inline-block;font-size:11px;padding:2px 10px;border-radius:4px;font-weight:500;background:var(--c-red);color:#fff">'+esc(t('calDetail.batchDue'))+'</span>';
    assignEl.innerHTML='';
    descEl.textContent=b?(b.species+(b.strain?' ('+b.strain+')':'')):'';
    descEl.style.display='';
    btnsEl.innerHTML='<span style="flex:1"></span><button class="btn" data-cal-action="close">'+esc(t('calDetail.close'))+'</button>';

  }else if(ev.type==='caldav-import'){
    titleEl.textContent=ev.label;
    let meta=t('calDetail.external');
    if(ev.date)meta+=' — '+new Date(ev.date).toLocaleDateString(loc(),{day:'numeric',month:'long',year:'numeric'});
    if(ev.startTime)meta+=', '+ev.startTime+(ev.endTime?' — '+ev.endTime:'');
    metaEl.textContent=meta;
    badgesEl.innerHTML='<span style="display:inline-block;font-size:11px;padding:2px 10px;border-radius:4px;font-weight:500;background:var(--c-indigo);color:#fff">'+esc(t('calDetail.external'))+'</span>';
    assignEl.innerHTML='';
    descEl.textContent=ev.description||'';
    descEl.style.display=ev.description?'':'none';
    btnsEl.innerHTML='<button class="btn" data-cal-action="close">'+esc(t('calDetail.close'))+'</button>';
  }
  document.getElementById('m-cal-detail').classList.add('open');
}

function closeEventDetail(){document.getElementById('m-cal-detail').classList.remove('open')}

// Delegated click handler for calendar detail buttons (avoids inline onclick XSS).
document.getElementById('cal-detail-btns').addEventListener('click',function(e){
  const btn=e.target.closest('[data-cal-action]');
  if(!btn)return;
  const action=btn.dataset.calAction;
  const id=btn.dataset.calId;
  if(action==='close')return closeEventDetail();
  if(action==='delete-event')return deleteCalEventFromDetail(id);
  if(action==='edit-event')return editEventFromDetail(id);
  if(action==='delete-task')return deleteTaskFromCalendar(id);
  if(action==='toggle-task')return toggleTaskFromCalendar(id);
  if(action==='edit-task')return editTaskFromCalendar(id);
});

function editEventFromDetail(id){
  closeEventDetail();
  const ce=calendarEvents.find(x=>x.id===id);
  if(ce)openEventModal(ce.startDate,ce.startTime,ce);
}

function deleteCalEventFromDetail(id){
  closeEventDetail();
  confirm2(t('calEntry.deleteEvent'),t('calEntry.deleteEventMsg'),t('calEntry.delete'),()=>{
    calendarEvents=calendarEvents.filter(x=>x.id!==id);
    renderCalendar();
    apiDelete('/api/calendar-events/'+encodeURIComponent(id));
  });
}

function toggleTaskFromCalendar(taskId){
  const t=manualTasks.find(t=>t.created===taskId);
  if(!t)return;
  toggleTask(t.id);
  renderCalendar();
  closeEventDetail();
}

function deleteTaskFromCalendar(taskId){
  closeEventDetail();
  confirm2(t('calEntry.deleteTask'),t('calEntry.deleteTaskMsg'),t('calEntry.delete'),()=>{
    const tk=manualTasks.find(x=>x.created===taskId);
    if(!tk)return;
    manualTasks=manualTasks.filter(x=>x.id!==tk.id);
    apiDelete('/api/tasks/'+tk.id);
    renderCalendar();updateTodoBadge();
  });
}

// ─── UNIFIED CALENDAR ENTRY MODAL ─────────────────────────────
const CATEGORY_COLORS={custom:'#16a34a',meeting:'#8b5cf6',delivery:'#14b8a6',maintenance:'#64748b'};
let calEntryType='task';

function setEntryType(type){
  const isTask=type==='task';
  calEntryType=isTask?'task':'event';
  document.getElementById('cal-entry-type-select').value=type;
  document.getElementById('cal-entry-enddate-wrap').style.display=isTask?'none':'';
  document.getElementById('cal-entry-allday-wrap').style.display='';
  document.getElementById('cal-entry-prio-wrap').style.display=isTask?'':'none';
  document.getElementById('cal-entry-task-assign-wrap').style.display=isTask?'':'none';
  document.getElementById('cal-entry-ev-assign-wrap').style.display=isTask?'none':'';
  document.getElementById('cal-entry-private-wrap').style.display=isTask?'flex':'none';
  const recWrap=document.getElementById('cal-entry-recurrence-wrap');
  if(recWrap)recWrap.style.display='grid';
  document.getElementById('cal-entry-name').placeholder=isTask?t('calEntry.namePhTask'):t('calEntry.namePhEvent');
  toggleEntryTimeInputs();
  toggleRecurrenceUntil();
}
function toggleRecurrenceUntil(){
  const sel=document.getElementById('cal-entry-recurrence');
  const wrap=document.getElementById('cal-entry-recurrence-until-wrap');
  if(sel&&wrap)wrap.style.display=sel.value?'':'none';
}

function openEntryModal(type,date,time,existing){
  const modal=document.getElementById('m-cal-entry');
  const isEdit=!!existing;
  document.getElementById('cal-entry-name').disabled=false;
  document.getElementById('cal-entry-desc').closest('div').style.display='';
  document.getElementById('cal-entry-type-select').closest('.g2').style.display='';
  document.getElementById('cal-entry-type-select').disabled=isEdit;
  setEntryType(type||'task');
  if(type==='task'&&existing){
    document.getElementById('cal-entry-title').textContent=t('calEntry.titleEdit');
    document.getElementById('cal-entry-mode').value='edit';
    document.getElementById('cal-entry-id').value=existing.id;
    document.getElementById('cal-entry-name').value=existing.text;
    document.getElementById('cal-entry-date').value=existing.dueDate?existing.dueDate.split('T')[0]:'';
    document.getElementById('cal-entry-allday').checked=!existing.dueTime;
    document.getElementById('cal-entry-start-time').value=existing.dueTime||'09:00';
    document.getElementById('cal-entry-end-time').value=existing.dueEndTime||'10:00';
    document.getElementById('cal-entry-prio').value=existing.priority||'med';
    calTaskSelectedAssignees=parseTaskAssignees(existing.assignee);
    renderTaskAssigneePicker();
    document.getElementById('cal-entry-desc').value=existing.description||'';
    document.getElementById('cal-entry-private').checked=!!existing.private;
    document.getElementById('cal-entry-recurrence').value=existing.recurrence||'';
    document.getElementById('cal-entry-recurrence-until').value=existing.recurrenceUntil||'';
    toggleRecurrenceUntil();
    document.getElementById('cal-entry-del-btn').style.display='';
  }else if(type==='event'&&existing){
    document.getElementById('cal-entry-title').textContent=t('calEntry.titleEdit');
    document.getElementById('cal-entry-mode').value='edit';
    document.getElementById('cal-entry-id').value=existing.id;
    document.getElementById('cal-entry-name').value=existing.title;
    document.getElementById('cal-entry-date').value=existing.startDate;
    document.getElementById('cal-entry-end-date').value=existing.endDate||'';
    document.getElementById('cal-entry-allday').checked=existing.allDay;
    document.getElementById('cal-entry-start-time').value=existing.startTime||'09:00';
    document.getElementById('cal-entry-end-time').value=existing.endTime||'10:00';
    setEntryType(existing.category||'custom');
    document.getElementById('cal-entry-desc').value=existing.description||'';
    calEvSelectedAssignees=Array.isArray(existing.teamAssignees)?existing.teamAssignees.slice():[];
    renderAssigneePicker();
    document.getElementById('cal-entry-recurrence').value=existing.recurrence||'';
    document.getElementById('cal-entry-recurrence-until').value=existing.recurrenceUntil||'';
    toggleRecurrenceUntil();
    document.getElementById('cal-entry-del-btn').style.display='';
  }else{
    document.getElementById('cal-entry-title').textContent=t('calEntry.titleNew');
    document.getElementById('cal-entry-mode').value='create';
    document.getElementById('cal-entry-id').value='';
    document.getElementById('cal-entry-name').value='';
    document.getElementById('cal-entry-date').value=date||localDateStr(new Date());
    document.getElementById('cal-entry-end-date').value='';
    document.getElementById('cal-entry-allday').checked=!time;
    document.getElementById('cal-entry-start-time').value=time||'09:00';
    const endH=time?String(Math.min(23,parseInt(time)+1)).padStart(2,'0')+':00':'10:00';
    document.getElementById('cal-entry-end-time').value=endH;
    document.getElementById('cal-entry-prio').value='med';
    calTaskSelectedAssignees=[];renderTaskAssigneePicker();
    document.getElementById('cal-entry-desc').value='';
    document.getElementById('cal-entry-private').checked=false;
    calEvSelectedAssignees=[];renderAssigneePicker();
    document.getElementById('cal-entry-recurrence').value='';
    document.getElementById('cal-entry-recurrence-until').value='';
    toggleRecurrenceUntil();
    document.getElementById('cal-entry-del-btn').style.display='none';
  }
  document.getElementById('cal-ev-assignee-dropdown').style.display='none';
  const tdd=document.getElementById('cal-task-assignee-dropdown');
  if(tdd)tdd.style.display='none';
  toggleEntryTimeInputs();
  modal.classList.add('open');
  if(!existing)setTimeout(()=>document.getElementById('cal-entry-name').focus(),50);
}

function parseTaskAssignees(val){
  if(!val)return [];
  if(Array.isArray(val))return val.slice();
  // Split comma-separated for backward compat with old single-assignee strings
  return String(val).split(',').map(s=>s.trim()).filter(Boolean);
}

function openEventModal(date,time,existing){openEntryModal(existing?'event':'custom',date,time,existing)}
function openTaskModal(date,existing){openEntryModal('task',date,null,existing)}

function closeEntryModal(){
  document.getElementById('m-cal-entry').classList.remove('open');
  const idEl=document.getElementById('cal-entry-id');
  idEl.dataset.moveType='';idEl.dataset.moveId='';
}
function closeEventModal(){closeEntryModal()}
function closeCalTaskModal(){closeEntryModal()}

function toggleEntryTimeInputs(){
  const timesEl=document.getElementById('cal-entry-times');
  timesEl.style.display=document.getElementById('cal-entry-allday').checked?'none':'grid';
}

function saveEntry(){
  const mode=document.getElementById('cal-entry-mode').value;
  if(mode==='move'){
    const idEl=document.getElementById('cal-entry-id');
    const moveType=idEl.dataset.moveType;
    const moveId=idEl.dataset.moveId;
    const newDate=document.getElementById('cal-entry-date').value;
    if(newDate&&moveType)handleCalendarDrop(moveType,moveId,newDate);
    closeEntryModal();return;
  }
  if(calEntryType==='task')saveEntryTask();
  else saveEntryEvent();
}

function saveEntryTask(){
  const mode=document.getElementById('cal-entry-mode').value;
  const text=document.getElementById('cal-entry-name').value.trim();
  if(!text)return;
  const prio=document.getElementById('cal-entry-prio').value;
  const due=document.getElementById('cal-entry-date').value||null;
  const allDay=document.getElementById('cal-entry-allday').checked;
  const dueTime=(!allDay&&due)?(document.getElementById('cal-entry-start-time').value||null):null;
  let dueEndTime=(!allDay&&due)?(document.getElementById('cal-entry-end-time').value||null):null;
  if(dueTime&&dueEndTime&&dueEndTime<=dueTime)dueEndTime=null;
  const assignee=calTaskSelectedAssignees.length?calTaskSelectedAssignees.join(','):null;
  const desc=document.getElementById('cal-entry-desc').value.trim()||null;
  const priv=document.getElementById('cal-entry-private').checked;
  const recurrence=document.getElementById('cal-entry-recurrence').value||null;
  const recurrenceUntil=recurrence?(document.getElementById('cal-entry-recurrence-until').value||null):null;
  if(mode==='edit'){
    const id=parseInt(document.getElementById('cal-entry-id').value);
    const tk=manualTasks.find(x=>x.id===id);
    if(!tk){closeEntryModal();return}
    tk.text=text;tk.priority=prio;tk.dueDate=due;tk.dueTime=dueTime;tk.dueEndTime=dueEndTime;tk.assignee=assignee;tk.description=desc;tk.private=priv;tk.recurrence=recurrence;tk.recurrenceUntil=recurrenceUntil;tk.caldavSynced=null;
    apiPatch('/api/tasks/'+id,{text:tk.text,priority:tk.priority,dueDate:tk.dueDate,dueTime:tk.dueTime,dueEndTime:tk.dueEndTime,assignee:tk.assignee,description:tk.description,private:priv?1:0,recurrence,recurrenceUntil,caldavSynced:null});
    if(caldav.enabled&&tk.caldavUid)pushTaskCaldav(tk);
  }else{
    const task={text,priority:prio,done:false,created:new Date().toISOString(),assignee,dueDate:due,dueTime,dueEndTime,description:desc,caldavUid:null,caldavSynced:null,private:priv,recurrence,recurrenceUntil};
    manualTasks.push(task);
    apiPost('/api/tasks',task).then(r=>{if(r&&r.id){task.id=r.id;if(caldav.enabled&&due)pushTaskCaldav(task)}renderCalendar();updateTodoBadge()});
  }
  closeEntryModal();
  if(document.getElementById('cal-entry-id').value){renderCalendar();updateTodoBadge()}
}

function saveEntryEvent(){
  const mode=document.getElementById('cal-entry-mode').value;
  const name=document.getElementById('cal-entry-name').value.trim();if(!name)return;
  const allDay=document.getElementById('cal-entry-allday').checked;
  const category=document.getElementById('cal-entry-type-select').value;
  const recurrence=document.getElementById('cal-entry-recurrence').value||null;
  const recurrenceUntil=recurrence?(document.getElementById('cal-entry-recurrence-until').value||null):null;
  const teamAssignees=calEvSelectedAssignees.slice();
  const ev={
    id:mode==='edit'?document.getElementById('cal-entry-id').value:('cev-'+Date.now()+'-'+Math.random().toString(36).slice(2,6)),
    title:name,
    description:document.getElementById('cal-entry-desc').value.trim()||null,
    startDate:document.getElementById('cal-entry-date').value,
    endDate:document.getElementById('cal-entry-end-date').value||null,
    allDay:allDay,
    startTime:allDay?null:document.getElementById('cal-entry-start-time').value,
    endTime:allDay?null:document.getElementById('cal-entry-end-time').value,
    category:category,
    color:CATEGORY_COLORS[category]||'#16a34a',
    caldavUid:null,caldavSynced:null,
    created:new Date().toISOString(),
    recurrence:recurrence,
    recurrenceUntil:recurrenceUntil,
    teamAssignees:teamAssignees,
    assignees:[]
  };
  if(mode==='edit'){
    const idx=calendarEvents.findIndex(x=>x.id===ev.id);
    if(idx>=0){ev.caldavUid=calendarEvents[idx].caldavUid;ev.created=calendarEvents[idx].created;calendarEvents[idx]=ev}
    apiPatch('/api/calendar-events/'+encodeURIComponent(ev.id),{title:ev.title,description:ev.description,startDate:ev.startDate,endDate:ev.endDate,allDay:ev.allDay,startTime:ev.startTime,endTime:ev.endTime,category:ev.category,color:ev.color,recurrence:ev.recurrence,recurrenceUntil:ev.recurrenceUntil,teamAssignees:ev.teamAssignees});
  }else{
    calendarEvents.push(ev);
    apiPost('/api/calendar-events',ev).then(r=>{if(r&&r.id)ev.id=r.id});
  }
  renderCalendar();closeEntryModal();
  if(caldav.enabled&&typeof pushEventCaldav==='function')pushEventCaldav(ev);
}

function deleteEntry(){
  if(calEntryType==='task'){
    const id=parseInt(document.getElementById('cal-entry-id').value);
    if(!id){closeEntryModal();return}
    closeEntryModal();
    confirm2(t('calEntry.deleteTask'),t('calEntry.deleteTaskMsg'),t('calEntry.delete'),()=>{
      manualTasks=manualTasks.filter(x=>x.id!==id);
      apiDelete('/api/tasks/'+id);
      renderCalendar();updateTodoBadge();
    });
  }else{
    const id=document.getElementById('cal-entry-id').value;if(!id)return;
    closeEntryModal();
    confirm2(t('calEntry.deleteEvent'),t('calEntry.deleteEventMsg'),t('calEntry.delete'),()=>{
      calendarEvents=calendarEvents.filter(x=>x.id!==id);
      apiDelete('/api/calendar-events/'+encodeURIComponent(id));
      renderCalendar();
    });
  }
}

function editTaskFromCalendar(taskId){
  closeEventDetail();
  const tk=manualTasks.find(x=>x.created===taskId);
  if(tk)openEntryModal('task',tk.dueDate,null,tk);
}

function onCalMonthEventClick(type,id){
  if(!type||!id)return;
  const events=collectCalendarEvents();
  const ev=events.find(e=>e.type===type&&String(e.id)===String(id));
  if(ev)onCalEventClick(ev);
}

function openEventMoveModal(ev){
  document.getElementById('cal-entry-title').textContent=t('calEntry.moveTitle');
  document.getElementById('cal-entry-id').value='';
  document.getElementById('cal-entry-mode').value='move';
  document.getElementById('cal-entry-name').value=ev.label;
  document.getElementById('cal-entry-name').disabled=true;
  document.getElementById('cal-entry-date').value=ev.date;
  document.getElementById('cal-entry-enddate-wrap').style.display='none';
  document.getElementById('cal-entry-allday-wrap').style.display='none';
  document.getElementById('cal-entry-times').style.display='none';
  document.getElementById('cal-entry-prio-wrap').style.display='none';
  document.getElementById('cal-entry-desc').closest('div').style.display='none';
  document.getElementById('cal-entry-task-assign-wrap').style.display='none';
  document.getElementById('cal-entry-ev-assign-wrap').style.display='none';
  const recWrapMove=document.getElementById('cal-entry-recurrence-wrap');
  if(recWrapMove)recWrapMove.style.display='none';
  document.getElementById('cal-entry-private-wrap').style.display='none';
  document.getElementById('cal-entry-del-btn').style.display='none';
  document.getElementById('cal-entry-type-select').closest('.g2').style.display='none';
  document.getElementById('cal-entry-id').dataset.moveType=ev.type;
  document.getElementById('cal-entry-id').dataset.moveId=ev.id;
  document.getElementById('m-cal-entry').classList.add('open');
}

async function pushEventCaldav(ev){
  if(!caldav.enabled)return;
  try{
    const r=await authFetch('/api/caldav/push-event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:ev})}).then(r=>r.json());
    if(r.ok&&r.uid){ev.caldavUid=r.uid;ev.caldavSynced=new Date().toISOString();apiPatch('/api/calendar-events/'+encodeURIComponent(ev.id),{caldavUid:ev.caldavUid,caldavSynced:ev.caldavSynced})}
  }catch(e){console.error('CalDAV event push error:',e)}
}

// ── User list + Assignee picker ──
async function loadAppUsers(){
  try{const r=await authFetch('/api/usernames');if(r.ok)appUsers=await r.json();fillCalendarUserFilter()}catch{appUsers=[]}
}
// Combined list of selectable people: registered users + manually-added team members (deduped)
function getSelectableAssignees(){
  const names=new Set();
  const out=[];
  (appUsers||[]).forEach(u=>{if(u&&u.username&&!names.has(u.username)){names.add(u.username);out.push(u.username)}});
  (teamMembers||[]).forEach(m=>{if(m&&m.name&&!names.has(m.name)){names.add(m.name);out.push(m.name)}});
  return out;
}
function fillCalendarUserFilter(){
  const sel=document.getElementById('cal-filter-user');if(!sel)return;
  const cur=sel.value;
  const names=getSelectableAssignees();
  sel.innerHTML='<option value="">'+esc(t('calEntry.assignTo.all'))+'</option>'+names.map(n=>'<option value="'+esc(n)+'">'+esc(n)+'</option>').join('');
  sel.value=cur;
}
function renderAssigneePicker(){
  const box=document.getElementById('cal-ev-assignees');if(!box)return;
  const dd=document.getElementById('cal-ev-assignee-dropdown');
  if(!calEvSelectedAssignees.length){box.innerHTML='<span style="color:var(--c-text-muted);font-size:12px">'+esc(t('calEntry.allClickToSelect'))+'</span>'}
  else{box.innerHTML=calEvSelectedAssignees.map(name=>'<span class="assignee-chip">'+esc(name)+' <button data-assignee-remove="'+esc(name)+'">×</button></span>').join('')}
  if(dd){
    const names=getSelectableAssignees();
    if(!names.length){
      dd.innerHTML='<div style="padding:8px;font-size:12px;color:var(--c-text-muted)">'+esc(t('calEntry.noMembers'))+'</div>';
    }else{
      dd.innerHTML=names.map(n=>{const checked=calEvSelectedAssignees.includes(n);return'<label style="display:flex;align-items:center;padding:6px 8px;cursor:pointer;font-size:12px;'+(checked?'background:#e8f5e9':'')+'" data-assignee-toggle="'+esc(n)+'"><input type="checkbox" '+(checked?'checked':'')+' style="width:auto;margin-right:6px" data-assignee-checkbox>'+esc(n)+'</label>'}).join('');
    }
  }
}
function toggleAssigneeDropdown(){
  const dd=document.getElementById('cal-ev-assignee-dropdown');if(!dd)return;
  dd.style.display=dd.style.display==='none'?'block':'none';
}
function toggleAssignee(name){
  const i=calEvSelectedAssignees.indexOf(name);
  if(i>=0)calEvSelectedAssignees.splice(i,1);else calEvSelectedAssignees.push(name);
  renderAssigneePicker();
}
function getSelectedAssigneeIds(){return calEvSelectedAssignees.slice()}
// Delegated click handlers for assignee picker (avoids inline onclick XSS)
(function(){
  const box=document.getElementById('cal-ev-assignees');
  if(box){box.addEventListener('click',function(e){
    const rm=e.target.closest('[data-assignee-remove]');
    if(!rm)return;
    e.stopPropagation();
    toggleAssignee(rm.dataset.assigneeRemove);
  })}
  const dd=document.getElementById('cal-ev-assignee-dropdown');
  if(dd){dd.addEventListener('click',function(e){
    if(e.target.matches('[data-assignee-checkbox]')){e.stopPropagation();return}
    const lbl=e.target.closest('[data-assignee-toggle]');
    if(!lbl)return;
    e.stopPropagation();e.preventDefault();
    toggleAssignee(lbl.dataset.assigneeToggle);
  })}
})();

// ── Task assignee picker (multi-select) ──
function renderTaskAssigneePicker(){
  const box=document.getElementById('cal-task-assignees');if(!box)return;
  const dd=document.getElementById('cal-task-assignee-dropdown');
  if(!calTaskSelectedAssignees.length){box.innerHTML='<span style="color:var(--c-text-muted);font-size:12px">'+esc(t('calEntry.allClickToSelect'))+'</span>'}
  else{box.innerHTML=calTaskSelectedAssignees.map(name=>'<span class="assignee-chip">'+esc(name)+' <button data-task-assignee-remove="'+esc(name)+'">×</button></span>').join('')}
  if(dd){
    const names=getSelectableAssignees();
    if(!names.length){
      dd.innerHTML='<div style="padding:8px;font-size:12px;color:var(--c-text-muted)">'+esc(t('calEntry.noMembers'))+'</div>';
    }else{
      dd.innerHTML=names.map(n=>{const checked=calTaskSelectedAssignees.includes(n);return'<label style="display:flex;align-items:center;padding:6px 8px;cursor:pointer;font-size:12px;'+(checked?'background:#e8f5e9':'')+'" data-task-assignee-toggle="'+esc(n)+'"><input type="checkbox" '+(checked?'checked':'')+' style="width:auto;margin-right:6px" data-assignee-checkbox>'+esc(n)+'</label>'}).join('');
    }
  }
}
function toggleTaskAssigneeDropdown(){
  const dd=document.getElementById('cal-task-assignee-dropdown');if(!dd)return;
  dd.style.display=dd.style.display==='none'?'block':'none';
}
function toggleTaskAssignee(name){
  const i=calTaskSelectedAssignees.indexOf(name);
  if(i>=0)calTaskSelectedAssignees.splice(i,1);else calTaskSelectedAssignees.push(name);
  renderTaskAssigneePicker();
}
// Delegated click handlers for task assignee picker (avoids inline onclick XSS)
(function(){
  const box=document.getElementById('cal-task-assignees');
  if(box){box.addEventListener('click',function(e){
    const rm=e.target.closest('[data-task-assignee-remove]');
    if(!rm)return;
    e.stopPropagation();
    toggleTaskAssignee(rm.dataset.taskAssigneeRemove);
  })}
  const dd=document.getElementById('cal-task-assignee-dropdown');
  if(dd){dd.addEventListener('click',function(e){
    if(e.target.matches('[data-assignee-checkbox]')){e.stopPropagation();return}
    const lbl=e.target.closest('[data-task-assignee-toggle]');
    if(!lbl)return;
    e.stopPropagation();e.preventDefault();
    toggleTaskAssignee(lbl.dataset.taskAssigneeToggle);
  })}
})();

async function loadCalDAVImports(){
  try{
    const r=await authFetch('/api/caldav/import');
    if(r.ok)caldavImports=await r.json();
  }catch(e){caldavImports=[];}
}

if(typeof pushBatchCaldav==='undefined'){
  window.pushBatchCaldav=async function(batch){
    if(!caldav.enabled)return;
    try{await authFetch('/api/caldav/push-batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({batch})})}catch(e){console.warn('CalDAV push failed:',e.message)}
  };
}

// Escape key closes the topmost open modal
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Escape') return;
  const modals = ['m-camscan','m-cal-entry','m-cal-detail','m-locmove','m-baginfo','m-addbags','m-batchadd','m-note','m-prompt','m-confirm','m-move-batch','m-batch-rename'];
  for (const id of modals) {
    const el = document.getElementById(id);
    if (el && el.classList.contains('open')) { el.classList.remove('open'); return; }
  }
});

initEventListeners();
loadCurrentUser();
loadAppUsers();
loadData();
// Primary: SSE for instant updates. Fallback: poll every 30s (was 5s) for stale detection.
connectSSE();
setInterval(pollSync,30000);

// Register service worker for PWA / offline support
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('/sw.js').catch(()=>{});
  });
  navigator.serviceWorker.addEventListener('message',e=>{
    if(e.data&&e.data.type==='offline-queue-update'){
      updateOfflineBadge(e.data.pendingCount);
    }
  });
  window.addEventListener('online',()=>{
    if(navigator.serviceWorker.controller){
      navigator.serviceWorker.controller.postMessage({type:'replay-pending'});
    }
  });
}

function updateOfflineBadge(count){
  let badge=document.getElementById('offline-badge');
  if(count===0){if(badge)badge.remove();return}
  if(!badge){
    badge=document.createElement('span');
    badge.id='offline-badge';
    badge.style.cssText='display:inline-block;background:var(--c-red);color:#fff;font-size:10px;padding:2px 6px;border-radius:8px;margin-left:6px;font-weight:600';
    const syncEl=document.getElementById('sync-label');
    if(syncEl)syncEl.parentNode.appendChild(badge);
    else document.querySelector('.topbar')?.appendChild(badge);
  }
  badge.textContent=count+' queued';
}

// ─── EVENT LISTENERS (CSP-safe, no inline handlers) ─────────────
let _camScanner=null;
let _camClosing=false;
let _camFacingMode='environment';
function openCamScan(){
  _initScanAudio(); // Init AudioContext during user gesture (required by iOS)
  document.getElementById('m-camscan').classList.add('open');
  updateCamHud(); // Sync HUD with current scan state
  if(_camScanner||_camClosing)return;
  _camScanner=new Html5Qrcode('cam-reader');
  var scanner=_camScanner;
  scanner.start(
    {facingMode:_camFacingMode},
    {fps:10,qrbox:function(vw,vh){var s=Math.min(250,Math.floor(Math.min(vw,vh)*0.7));return{width:s,height:s}},aspectRatio:1.0},
    function(decoded){
      if(scanner!==_camScanner)return;
      scanner.pause(true);
      processScan(decoded);
      setTimeout(function(){if(scanner===_camScanner){try{scanner.resume()}catch(e){}}},1500);
    },
    function(){}
  ).catch(function(err){
    console.error('Camera start failed:',err);
    var msg;var s=String(err);
    if(/NotAllowedError|Permission/.test(s))msg='Kamera-Berechtigung verweigert. Bitte in den Browser-Einstellungen erlauben.';
    else if(/NotFoundError/.test(s))msg='Keine Kamera gefunden.';
    else if(/NotReadableError|TrackStartError/.test(s))msg='Kamera wird von anderer App verwendet.';
    else if(/OverconstrainedError/.test(s))msg='Kamera unterstützt die gewünschte Auflösung nicht.';
    else if(/InsecureContext|https/.test(s))msg='Kamera benötigt HTTPS. Bitte sichere Verbindung verwenden.';
    else msg='Kamera konnte nicht gestartet werden: '+err;
    setFb('err',msg);
    closeCamScan();
  });
}
function closeCamScan(){
  document.getElementById('m-camscan').classList.remove('open');
  if(!_camScanner)return;
  var scanner=_camScanner;
  _camScanner=null;
  _camClosing=true;
  scanner.stop().then(function(){scanner.clear()}).catch(function(){
    // Force-stop media tracks if library cleanup fails (iOS Safari)
    var vids=document.getElementById('cam-reader').querySelectorAll('video');
    vids.forEach(function(v){if(v.srcObject)v.srcObject.getTracks().forEach(function(t){t.stop()})});
    try{scanner.clear()}catch(e){}
  }).finally(function(){_camClosing=false});
}
// Stop camera when tab is hidden (saves battery, prevents "camera in use" on other apps)
document.addEventListener('visibilitychange',function(){if(document.hidden&&_camScanner)closeCamScan()});
function flipCamera(){
  _camFacingMode=_camFacingMode==='environment'?'user':'environment';
  if(_camScanner){closeCamScan();setTimeout(openCamScan,300)}
}
function copyCalDavUrl(){const url=document.getElementById('caldav-url-display').textContent;navigator.clipboard.writeText(url).then(()=>{const b=document.getElementById('btn-45');b.textContent='Kopiert!';setTimeout(()=>{b.textContent='Kopieren'},2000)}).catch(()=>{})}

function initEventListeners() {
  const $=id=>document.getElementById(id);

  // Modals
  $('addbags-cancel-btn').addEventListener('click', () => { document.getElementById('m-addbags').classList.remove('open'); });
  $('addbags-confirm-btn').addEventListener('click', confirmAddBags);
  $('ab-done-btn').addEventListener('click', () => { document.getElementById('m-addbags').classList.remove('open'); });
  $('ab-print-btn').addEventListener('click', printNewBags);
  $('m-cancel').addEventListener('click', closeConfirm);
  $('change-pw-modal').addEventListener('click', function(e) { if(e.target===this) hideChangePasswordModal(); });
  $('btn-1').addEventListener('click', hideChangePasswordModal);
  $('act-2').addEventListener('click', submitChangePassword);
  $('cls-3').addEventListener('click', closeNote);
  $('act-4').addEventListener('click', saveNote);
  $('m-cal-detail').addEventListener('click', function(e) { if(e.target===this) closeEventDetail(); });
  $('ba-batch').addEventListener('change', baPreview);
  $('ba-loc').addEventListener('change', baPreview);
  $('cls-7').addEventListener('click', closeBatchAdd);
  $('act-8').addEventListener('click', confirmBatchAdd);
  $('m-locmove').addEventListener('click', function(e) { if(e.target===this) this.classList.remove('open'); });
  $('cls-9').addEventListener('click', () => { document.getElementById('m-locmove').classList.remove('open'); });
  // Move-batch modal
  $('mb-cancel-btn').addEventListener('click', () => { document.getElementById('m-move-batch').classList.remove('open'); });
  $('m-move-batch').addEventListener('click', function(e) { if(e.target===this) this.classList.remove('open'); });
  // Batch rename modal
  $('br-cancel-btn').addEventListener('click', () => { document.getElementById('m-batch-rename').classList.remove('open'); });
  $('m-batch-rename').addEventListener('click', function(e) { if(e.target===this) this.classList.remove('open'); });
  $('br-new-id').addEventListener('keydown', e => { if(e.key==='Enter') document.getElementById('br-confirm-btn').click(); });
  document.getElementById('lm-grid').addEventListener('click', e=>{
    const btn=e.target.closest('[data-action="bulk-rack-target"]');if(!btn)return;
    executeBulkMoveToRack(btn.dataset.zone,btn.dataset.rack);
  });
  $('btn-10').addEventListener('click', locRemoveSelected);
  $('cls-11').addEventListener('click', () => { document.getElementById('m-baginfo').classList.remove('open'); });
  $('set-12').addEventListener('click', () => { biSetAction('ADD'); });
  $('set-13').addEventListener('click', () => { biSetAction('MOVE'); });
  $('set-14').addEventListener('click', () => { biSetAction('HARVEST'); });
  $('set-15').addEventListener('click', () => { biSetAction('REMOVE'); });
  $('m-camscan').addEventListener('click', function(e) { if(e.target===this) closeCamScan(); });
  $('cls-16').addEventListener('click', closeCamScan);
  $('btn-flip-cam').addEventListener('click', flipCamera);

  // Sidebar navigation
  $('sb-toggle').addEventListener('click', toggleSidebar);
  $('n-dash').addEventListener('click', () => { go('dash','n-dash'); });
  $('n-cal').addEventListener('click', () => { go('cal','n-cal'); });
  $('n-batch').addEventListener('click', () => { go('batch','n-batch'); });
  $('n-lab').addEventListener('click', () => { go('lab','n-lab'); });
  $('n-inv').addEventListener('click', () => { go('inv','n-inv'); });
  $('n-zones').addEventListener('click', () => { go('zones','n-zones'); });
  $('n-strains').addEventListener('click', () => { go('strains','n-strains'); renderStrains(); });
  $('btn-add-zone').addEventListener('click', addZone);
  $('btn-print-all-zone-qr').addEventListener('click', printAllZoneQrBrowser);
  $('zone-role').addEventListener('change', function(){const c={spawn:'#a855f7',incubation:'#0ea5e9',fruiting:'#10b981',contaminated:'#ef4444'}[this.value];if(c)document.getElementById('zone-color').value=c});
  // Zone list event delegation (CSP blocks inline onclick)
  $('zones-list').addEventListener('click', e=>{
    const btn=e.target.closest('[data-action]');if(!btn)return;
    const action=btn.dataset.action;
    if(action==='del-zone')removeZone(btn.dataset.zone);
    else if(action==='rename-zone')renameZone(btn.dataset.zone);
    else if(action==='add-rack')addRackToZone(btn.dataset.zone);
    else if(action==='del-rack')removeRack(btn.dataset.rack);
    else if(action==='toggle-qr')renderZoneQrPanel(btn.dataset.zone);
    else if(action==='print-zone-qr')printZoneQrBrowser(btn.dataset.zone);
    else if(action==='bulk-move')bulkMoveToRack(btn.dataset.zone);
  });
  // Drag-and-drop zone reordering.
  const zonesList=$('zones-list');
  zonesList.addEventListener('dragstart',onZoneDragStart);
  zonesList.addEventListener('dragover',onZoneDragOver);
  zonesList.addEventListener('drop',onZoneDrop);
  zonesList.addEventListener('dragend',onZoneDragEnd);
  zonesList.addEventListener('dragleave',e=>{
    // Clear hints only when leaving the list entirely, not when moving between rows.
    if(!zonesList.contains(e.relatedTarget))clearZoneDropHints();
  });
  $('n-assets').addEventListener('click', () => { go('assets','n-assets'); });
  $('n-print').addEventListener('click', () => { go('print','n-print'); });
  $('n-settings').addEventListener('click', () => { go('settings','n-settings'); });
  $('sync-dot').addEventListener('click', loadData);
  $('lang-sel').addEventListener('change', function() { setLang(this.value); });
  $('tgl-17').addEventListener('click', toggleSidebar);
  $('sync-dot-m').addEventListener('click', loadData);
  $('sb-overlay').addEventListener('click', toggleSidebar);

  // Scan modal
  $('scan-overlay').addEventListener('click', closeScanModal);
  $('scan-modal').addEventListener('click', e => e.stopPropagation());
  $('cls-18').addEventListener('click', closeScanModal);
  $('set-19').addEventListener('click', resetScan);
  $('btn-20').addEventListener('click', openBatchAdd);
  $('btn-end-session').addEventListener('click', endScanSession);
  $('btn-scan-cam').addEventListener('click', function() { openCamScan(); });
  $('btn-scan-audio').addEventListener('click', function() { scanAudioEnabled=!scanAudioEnabled;this.style.opacity=scanAudioEnabled?1:.4; });
  // Scan modal tab navigation
  document.querySelectorAll('.scan-tab').forEach(function(tabBtn){
    tabBtn.addEventListener('click',function(){
      var name=this.getAttribute('data-scan-tab');
      switchScanTab(name);
      if(name==='successes')renderScanSuccesses();
    });
  });

  // Harvest panel
  $('act-21').addEventListener('click', confirmHarvest);
  $('btn-22').addEventListener('click', cancelHarvest);

  // Dashboard
  $('dash-batch-filter').addEventListener('change', renderDashBatchTasks);
  $('status-q').addEventListener('input', renderStatus);

  // Batches — delegated actions for dynamically rendered rows (CSP-safe)
  $('batches-body').addEventListener('click', function(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const batch = el.dataset.batch;
    switch(el.dataset.action) {
      case 'toggle-bags': toggleBatchBags(batch); break;
      case 'open-note': openNote(batch); break;
      case 'add-bags': openAddBags(batch); break;
      case 'del-batch': delBatch(batch); break;
      case 'rename-batch': openBatchRenameModal(batch); break;
      case 'open-move-modal':
        openMoveBatchModal(batch);
        break;
    }
  });
  $('st-batch-list').addEventListener('click', () => { openStab('batch','list'); });
  $('st-batch-new').addEventListener('click', () => { openStab('batch','new'); });
  $('st-batch-harvest').addEventListener('click', () => { openStab('batch','harvest'); });
  $('batch-q').addEventListener('input', renderBatches);
  $('wbtn-3').addEventListener('click', () => { setBagWeight(3); });
  $('wbtn-5').addEventListener('click', () => { setBagWeight(5); });
  $('nb-weight').addEventListener('input', nbPreview);
  $('nb-strain-sel').addEventListener('change', nbPreview);
  $('nb-qty').addEventListener('input', nbPreview);
  $('nb-hw').addEventListener('input', nbSubSum);
  $('nb-wb').addEventListener('input', nbSubSum);
  $('nb-rh').addEventListener('input', nbPreview);
  $('ms-save-btn').addEventListener('click', saveMStrain);
  $('ms-cancel-btn').addEventListener('click', cancelMStrain);
  $('btn-24').addEventListener('click', createBatch);
  $('prt-25').addEventListener('click', goToPrintBatch);
  $('harvest-q').addEventListener('input', renderHarvests);

  // Lab
  $('st-lab-cultures').addEventListener('click', () => { openStab('lab','cultures'); });
  $('st-lab-work').addEventListener('click', () => { openStab('lab','work'); });
  $('st-lab-lineage').addEventListener('click', () => { openStab('lab','lineage'); });
  // Grain spawn form (now embedded in Log Work tab)
  $('gs-wbtn-07').addEventListener('click', () => { gsSetWeight(0.7); });
  $('gs-wbtn-1').addEventListener('click', () => { gsSetWeight(1); });
  $('gs-wbtn-2').addEventListener('click', () => { gsSetWeight(2); });
  $('gs-wbtn-5').addEventListener('click', () => { gsSetWeight(5); });
  $('gs-weight').addEventListener('input', gsPreview);
  $('gs-qty').addEventListener('input', gsPreview);
  $('prt-gs').addEventListener('click', goToPrintGrainBatch);
  $('cult-type').addEventListener('change', renderCultures);
  $('cult-stat').addEventListener('change', renderCultures);
  $('lw-type').addEventListener('change', lwUpdate);
  $('lw-st').addEventListener('change', () => { const type=document.getElementById('lw-type').value; if(type==='KB')gsPreview(); else lwPreview(); });
  $('lw-qty').addEventListener('input', lwPreview);
  $('btn-26').addEventListener('click', () => { const type=document.getElementById('lw-type').value; if(type==='KB')createGrainBatch(); else logLabWork(); });
  $('lineage-sel').addEventListener('change', renderLineage);

  // Print
  $('st-print-bags').addEventListener('click', () => { openStab('print','bags'); });
  $('st-print-lab').addEventListener('click', () => { openStab('print','lab'); });
  $('st-print-ref').addEventListener('click', () => { openStab('print','ref'); });
  $('print-batch').addEventListener('change', renderBagPreview);
  $('print-mode').addEventListener('change', renderBagPreview);
  $('print-range').addEventListener('change', toggleBagRange);
  $('prt-27').addEventListener('click', printBagLabels);
  $('lab-filter').addEventListener('change', renderLabList);
  $('lp-bc').addEventListener('change', renderLabPreview);
  $('lp-qr').addEventListener('change', renderLabPreview);
  $('prt-28').addEventListener('click', printLabLabels);
  $('ref-qr').addEventListener('change', renderRefBarcodes);
  $('prt-29').addEventListener('click', printRef);

  // Calendar
  $('btn-33').addEventListener('click', calToday);
  $('btn-34').addEventListener('click', () => { calNav(-1); });
  $('btn-35').addEventListener('click', () => { calNav(1); });
  $('cal-filter-user').addEventListener('change', renderCalendar);
  $('cv-month').addEventListener('click', () => { setCalView('month'); });
  $('cv-week').addEventListener('click', () => { setCalView('week'); });
  $('cv-day').addEventListener('click', () => { setCalView('day'); });
  // Unified calendar entry modal
  $('btn-cal-print').addEventListener('click', printCalendar);
  $('m-cal-print-week').addEventListener('click', ()=>printCalendarTaskList('week'));
  $('m-cal-print-month').addEventListener('click', ()=>printCalendarTaskList('month'));
  $('m-cal-print-cancel').addEventListener('click', closeCalPrintModal);
  $('m-cal-print').addEventListener('click', e=>{if(e.target.id==='m-cal-print')closeCalPrintModal()});
  $('btn-cal-add').addEventListener('click', ()=>openEntryModal());
  $('cal-entry-cancel-btn').addEventListener('click', closeEntryModal);
  $('cal-entry-save-btn').addEventListener('click', saveEntry);
  $('cal-entry-del-btn').addEventListener('click', deleteEntry);
  $('cal-entry-allday').addEventListener('change', toggleEntryTimeInputs);
  $('cal-entry-type-select').addEventListener('change', function(){setEntryType(this.value)});
  $('cal-entry-recurrence').addEventListener('change', toggleRecurrenceUntil);
  $('m-cal-entry').addEventListener('click', e=>{if(e.target.id==='m-cal-entry')closeEntryModal()});
  $('cal-ev-assignees').addEventListener('click', toggleAssigneeDropdown);
  const taBox=$('cal-task-assignees');if(taBox)taBox.addEventListener('click', toggleTaskAssigneeDropdown);

  // Settings
  $('st-settings-log').addEventListener('click', () => { openStab('settings','log'); });
  $('st-settings-backup').addEventListener('click', () => { openStab('settings','backup'); });
  $('st-settings-users').addEventListener('click', () => { openStab('settings','users');loadUsersTab(); });
  $('st-settings-caldav').addEventListener('click', () => { openStab('settings','caldav'); });
  $('st-settings-duckdns').addEventListener('click', () => { openStab('settings','duckdns'); });
  $('st-settings-mcp').addEventListener('click', () => { openStab('settings','mcp'); });
  $('st-settings-server').addEventListener('click', () => { openStab('settings','server'); loadServerTab(); });
  $('btn-server-restart').addEventListener('click', restartServer);
  $('duckdns-save-btn').addEventListener('click', saveDuckdnsSettings);
  $('duckdns-update-btn').addEventListener('click', triggerDuckdnsUpdate);
  $('le-request-btn').addEventListener('click', requestLeCert);
  $('mcp-save-btn').addEventListener('click', saveMcpSettings);
  $('mcp-gen-token-btn').addEventListener('click', generateMcpToken);
  $('mcp-enabled').addEventListener('change', function(){ toggleMcpSections(this.checked); });
  $('mcp-copy-url-btn').addEventListener('click', ()=>{navigator.clipboard.writeText($('mcp-url').value);showMcpStatus(t('mcp.urlCopied'),'var(--c-green-dark)');});
  $('mcp-diag-btn').addEventListener('click', runMcpDiagnostics);
  $('mcp-copy-token-btn').addEventListener('click', ()=>{navigator.clipboard.writeText(_mcpToken);showMcpStatus(t('mcp.keyCopied'),'var(--c-green-dark)');});
  $('log-action-filter').addEventListener('change', renderLog);
  $('log-date-from').addEventListener('change', renderLog);
  $('log-date-to').addEventListener('change', renderLog);
  $('log-q').addEventListener('input', renderLog);
  $('btn-37').addEventListener('click', clearLog);
  $('tgl-38').addEventListener('click', () => { toggleLogSort('time'); });
  $('tgl-39').addEventListener('click', () => { toggleLogSort('action'); });
  $('ctl-40').addEventListener('click', () => { logDisplayLimit+=200;renderLog(); });
  $('btn-41').addEventListener('click', downloadBackup);
  $('btn-42').addEventListener('click', restoreBackup);
  $('btn-43').addEventListener('click', doLogout);
  $('btn-44').addEventListener('click', addUser);
  $('btn-45').addEventListener('click', copyCalDavUrl);
  $('caldav-enabled').addEventListener('change', saveCaldavSettings);
  $('act-46').addEventListener('click', saveCaldavSettings);
  $('caldav-sync-btn').addEventListener('click', syncCaldavNow);

  // Inventory
  $('st-inv-stock').addEventListener('click', () => { openStab('inv','stock'); });
  $('st-inv-delivery').addEventListener('click', () => { openStab('inv','delivery'); });
  $('st-inv-log').addEventListener('click', () => { openStab('inv','log'); });
  $('st-inv-suppliers').addEventListener('click', () => { openStab('inv','suppliers');renderSuppliers(); });
  $('del-mat').addEventListener('change', delMatChange);
  $('del-kg').addEventListener('input', delPreview);
  $('btn-47').addEventListener('click', logDelivery);
  $('adj-mat').addEventListener('change', adjMatChange);
  $('adj-absolute').addEventListener('input', () => { adjPreview('absolute'); });
  $('adj-delta').addEventListener('input', () => { adjPreview('delta'); });
  $('btn-48').addEventListener('click', logAdjustment);
  $('inv-log-filter').addEventListener('change', renderInvLog);

  // Assets
  $('st-assets-list').addEventListener('click', () => { openStab('assets','list'); });
  $('st-assets-add').addEventListener('click', () => { openStab('assets','add'); });
  $('st-assets-export').addEventListener('click', () => { openStab('assets','export'); });
  $('st-assets-labels').addEventListener('click', () => { openStab('assets','labels'); });
  $('asset-cat-filter').addEventListener('change', renderAssets);
  $('asset-stat-filter').addEventListener('change', renderAssets);
  $('asset-search').addEventListener('input', renderAssets);
  $('asset-status').addEventListener('change', assetStatusChange);
  $('act-49').addEventListener('click', saveAsset);
  $('set-50').addEventListener('click', resetAssetForm);
  $('set-51').addEventListener('click', exportAssetCSV);
  $('ctl-52').addEventListener('click', renderStichtagReport);
  $('tgl-53').addEventListener('click', () => { toggleAllAssetLabels(true); });
  $('tgl-54').addEventListener('click', () => { toggleAllAssetLabels(false); });
  $('prt-55').addEventListener('click', printAssetLabels);
  $('set-56').addEventListener('click', downloadAssetZPL);

}

// Camera FAB is in the HTML *after* the <script> tag, so it doesn't exist
// when initEventListeners() runs. Bind it once the full DOM is ready.
document.addEventListener('DOMContentLoaded', function() {
  var fab = document.getElementById('cam-fab');
  if(fab) fab.addEventListener('click', openCamScan);
});

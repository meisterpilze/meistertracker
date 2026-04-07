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
    'nav.assets': 'Assets',
    'nav.print': 'Print',
    'nav.todo': 'To-do',
    'nav.calendar': 'Calendar',
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
    'dash.harvestBySpecies': 'Harvest by species (g)',
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
    'settings.restoreDescHtml': 'Restore from an encrypted backup file. <strong style="color:#b91c1c">Replaces all current data for everyone.</strong>',
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
    'inv.blocks': '\u2248 <strong>{n}</strong> \u00d7 {kg}kg blocks <span style="font-size:10px;color:#aaa">(avg estimate)</span>',
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
    'scanFb.actionMove': 'Action: MOVE \u2192 scan FROM location',
    'scanFb.actionRemove': 'Action: REMOVE \u2192 scan bags',
    'scanFb.actionHarvest': 'Action: HARVEST \u2192 scan a bag to log its weight',
    'scanFb.location': 'Location: {loc} \u2192 now scan bags (location stays until you change it)',
    'scanFb.from': 'From: {loc} \u2192 scan the TO location',
    'scanFb.to': 'To: {loc} \u2192 now scan bags',
    'scanFb.setAction': 'Set an action first \u2014 scan ADD, MOVE, REMOVE or HARVEST.',
    'scanFb.scanLocFirst': 'Scan a location or rack first.',
    'scanFb.scanFromTo': 'Scan FROM and TO locations first.',
    'scanFb.logged': 'Logged: {action} {val}{to} [{n} this session]',
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
    'settings.restoreDescHtml': 'Restore from an encrypted backup file. <strong style="color:#b91c1c">Replaces all current data for everyone.</strong>',
    'caldav.passwordLabel': 'Password',
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
  },
  de: {
    // Nav
    'nav.main': 'Hauptmenü',
    'nav.tools': 'Werkzeuge',
    'nav.dashboard': 'Dashboard',
    'nav.batches': 'Chargen',
    'nav.lab': 'Labor',
    'nav.inventory': 'Lager',
    'nav.assets': 'Anlagen',
    'nav.print': 'Drucken',
    'nav.todo': 'Aufgaben',
    'nav.calendar': 'Kalender',
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
    'dash.harvestBySpecies': 'Ernte nach Art (g)',
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
    'settings.restoreDescHtml': 'Aus einer verschlüsselten Backup-Datei wiederherstellen. <strong style="color:#b91c1c">Ersetzt alle aktuellen Daten für alle Benutzer.</strong>',
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
    'inv.blocks': '\u2248 <strong>{n}</strong> \u00d7 {kg}kg Bl\u00f6cke <span style="font-size:10px;color:#aaa">(Sch\u00e4tzung)</span>',
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
    'scanFb.actionMove': 'Aktion: MOVE \u2192 VON-Standort scannen',
    'scanFb.actionRemove': 'Aktion: REMOVE \u2192 Beutel scannen',
    'scanFb.actionHarvest': 'Aktion: HARVEST \u2192 Beutel f\u00fcr Gewichtserfassung scannen',
    'scanFb.location': 'Standort: {loc} \u2192 jetzt Beutel scannen',
    'scanFb.from': 'Von: {loc} \u2192 NACH-Standort scannen',
    'scanFb.to': 'Nach: {loc} \u2192 jetzt Beutel scannen',
    'scanFb.setAction': 'Zuerst Aktion setzen \u2014 scanne ADD, MOVE, REMOVE oder HARVEST.',
    'scanFb.scanLocFirst': 'Zuerst Standort oder Regal scannen.',
    'scanFb.scanFromTo': 'Erst VON- und NACH-Standort scannen.',
    'scanFb.logged': 'Erfasst: {action} {val}{to} [{n} diese Sitzung]',
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
    'settings.restoreDescHtml': 'Aus einer verschlüsselten Backup-Datei wiederherstellen. <strong style="color:#b91c1c">Ersetzt alle aktuellen Daten für alle Nutzer.</strong>',
    'caldav.passwordLabel': 'Passwort',
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
  },
  pt: {
    // Nav
    'nav.main': 'Principal',
    'nav.tools': 'Ferramentas',
    'nav.dashboard': 'Painel',
    'nav.batches': 'Lotes',
    'nav.lab': 'Laborat\u00f3rio',
    'nav.inventory': 'Invent\u00e1rio',
    'nav.assets': 'Ativos',
    'nav.print': 'Imprimir',
    'nav.todo': 'Tarefas',
    'nav.calendar': 'Calendário',
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
    'dash.harvestBySpecies': 'Colheita por esp\u00e9cie (g)',
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
    'settings.restoreDescHtml': 'Restaurar de um arquivo de backup criptografado. <strong style="color:#b91c1c">Substitui todos os dados atuais para todos os usuários.</strong>',
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
    'inv.blocks': '\u2248 <strong>{n}</strong> \u00d7 {kg}kg blocos <span style="font-size:10px;color:#aaa">(estimativa)</span>',
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
    'scanFb.actionMove': 'A\u00e7\u00e3o: MOVE \u2192 escaneie local DE origem',
    'scanFb.actionRemove': 'A\u00e7\u00e3o: REMOVE \u2192 escaneie sacos',
    'scanFb.actionHarvest': 'A\u00e7\u00e3o: HARVEST \u2192 escaneie um saco para registrar peso',
    'scanFb.location': 'Local: {loc} \u2192 agora escaneie sacos',
    'scanFb.from': 'De: {loc} \u2192 escaneie o local PARA',
    'scanFb.to': 'Para: {loc} \u2192 agora escaneie sacos',
    'scanFb.setAction': 'Defina uma a\u00e7\u00e3o primeiro \u2014 escaneie ADD, MOVE, REMOVE ou HARVEST.',
    'scanFb.scanLocFirst': 'Escaneie um local ou estante primeiro.',
    'scanFb.scanFromTo': 'Escaneie os locais DE e PARA primeiro.',
    'scanFb.logged': 'Registrado: {action} {val}{to} [{n} nesta sess\u00e3o]',
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
    'settings.restoreDescHtml': 'Restaurar de um arquivo de backup criptografado. <strong style="color:#b91c1c">Substitui todos os dados atuais para todos os usuários.</strong>',
    'caldav.passwordLabel': 'Senha',
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
  }
};

// ─── CONSTANTS ───────────────────────────────────────────────
const ACTIONS=['ADD','MOVE','REMOVE','HARVEST'];
const ZONES=['SPAWN','INC','TENT1','TENT2','TENT3','CONTAM'];
const SPAWN_RACKS=['SPAWN_R1','SPAWN_R2'];
const INC_RACKS=['INC_R1','INC_R2','INC_R3','INC_R4','INC_R5','INC_R6','INC_R7','INC_R8','INC_R9','INC_R10'];
const ALL_RACKS=[...SPAWN_RACKS,...INC_RACKS];
const LOCS=[...ZONES,...ALL_RACKS];
const RACK_ZONE=Object.fromEntries([...SPAWN_RACKS.map(r=>[r,'SPAWN']),...INC_RACKS.map(r=>[r,'INC'])]);
const toZone=loc=>RACK_ZONE[loc]||loc;
const ABBR={Kings:'KINGS',Oyster:'OYS',Shiitake:'SHII',Reishi:'REI',"Lion's Mane":'LION'};
const SP_COLORS=['#ef4444','#3b82f6','#22c55e','#f59e0b','#8b5cf6','#14b8a6','#f97316','#ec4899','#06b6d4','#84cc16'];
const REF_GROUPS=[
  {g:'Actions',items:['ADD','MOVE','REMOVE','HARVEST']},
  {g:'Zones',items:['SPAWN','INC','TENT1','TENT2','TENT3','CONTAM']},
  {g:'SPAWN racks',items:['SPAWN_R1','SPAWN_R2']},
  {g:'INC racks 1–5',items:['INC_R1','INC_R2','INC_R3','INC_R4','INC_R5']},
  {g:'INC racks 6–10',items:['INC_R6','INC_R7','INC_R8','INC_R9','INC_R10']},
  {g:'Quantities',items:['1','2','3','4','5','6','7','8','9','10']}
];

// ─── DATA ────────────────────────────────────────────────────
let batches=[],scanLog=[],movements=[],manualTasks=[],harvests=[],cultures=[],inventory={},teamMembers=[],caldav={},assets=[];
let appUsers=[];let calEvSelectedAssignees=[];
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
  if(!c)return fallback||'#22c55e';
  return /^#[0-9a-fA-F]{3,8}$/.test(c)?c:(fallback||'#22c55e');
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
    if(!r.ok)throw new Error('HTTP '+r.status);
    return r.json();
  }).then(d=>{
    _mutating--;
    if(_mutating===0)setSyncStatus('ok','Saved · gerade eben');
    return d;
  }).catch(e=>{
    _mutating--;
    setSyncStatus('err','Save error: '+(e.message||'check server'));
    console.error('API error:',method,path,e);
    return {};
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
  batches=d.batches||[];scanLog=d.scanLog||[];movements=d.movements||d.scanLog||[];manualTasks=d.manualTasks||[];
  harvests=d.harvests||[];cultures=d.cultures||[];
  inventory=d.inventory||defaultInventory();
  teamMembers=d.teamMembers||[];caldav=d.caldav||{};assets=d.assets||[];
  calendarEvents=d.calendarEvents||[];
  batches.forEach(b=>spColor(b.species));cultures.forEach(c=>spColor(c.species));
  fillCultureSelect('nb-culture',['PD','LC']);updateTodoBadge();
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
const PAGES={dash:'n-dash',batch:'n-batch',lab:'n-lab',assets:'n-assets',print:'n-print',cal:'n-cal',settings:'n-settings'};
function go(page,btnId){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.sb-nav .sb-btn, .sb-footer .sb-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('p-'+page).classList.add('active');
  document.getElementById(btnId).classList.add('active');
  if(page==='dash'){renderStatus();renderDashAlerts();renderDashBatchTasks();}
  if(page==='batch')renderBatches();
  if(page==='lab')renderCultures();
  if(page==='inv'){renderInvStock();}
  if(page==='assets')renderAssets();
  if(page==='print'){fillBatchSelect();renderLabList();}
  if(page==='cal'){renderCalendar();loadCalDAVImports().then(()=>renderCalendar());}
  if(page==='settings')renderLog();
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
  if(id==='cal')renderCalendar();
  updateTodoBadge();
}

// ─── MODALS ──────────────────────────────────────────────────
function confirm2(title,body,label,cb){document.getElementById('m-title').textContent=title;document.getElementById('m-body').textContent=body;document.getElementById('m-ok').textContent=label||'Confirm';confirmCb=cb;document.getElementById('m-confirm').classList.add('open')}
function closeConfirm(){document.getElementById('m-confirm').classList.remove('open');confirmCb=null}
document.getElementById('m-ok').onclick=()=>{if(confirmCb)confirmCb();closeConfirm()};
document.getElementById('m-confirm').addEventListener('click',e=>{if(e.target.id==='m-confirm')closeConfirm()});
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
  const now=new Date().toISOString();
  const entries=[];batch.bags.forEach(bagId=>{const entry={time:now,action:'ADD',batch:id,bag:bagId,from:null,to:loc,species:batch.species,strain:batch.strain,user:currentUser?.username||null};scanLog.push(entry);movements.push(entry);scan.count++;entries.push(entry)});
  apiPost('/api/scan-log',{entries});updateSD();setFb('ok',`Batch ADD: ${batch.bags.length} bags → ${loc}`);closeBatchAdd();
}

// ─── HELPERS ─────────────────────────────────────────────────
const abbrev=s=>{if(!s)return'BAG';const u=s.toLowerCase();for(const k in ABBR)if(k.toLowerCase()===u)return ABBR[k];return s.replace(/\s+/g,'').slice(0,5).toUpperCase()};
const todayStr=()=>{const d=new Date();return String(d.getDate()).padStart(2,'0')+String(d.getMonth()+1).padStart(2,'0')+String(d.getFullYear()).slice(2)};
const genBatchId=sp=>{const ab=abbrev(sp),dt=todayStr(),n=batches.filter(b=>b.batchId.startsWith(ab+'-'+dt)).length;return ab+'-'+dt+'-'+String(n+1).padStart(2,'0')};
const sbadge=s=>{const m={INCUBATING:'b-inc',FRUITING:'b-tent','SPAWN RUN':'b-spawn',CONTAM:'b-contam',DONE:'b-done',EMPTY:'b-done'};return`<span class="badge ${m[s]||'b-done'}">${s}</span>`};

// ─── STATUS CALC ─────────────────────────────────────────────
function getStatus(id){
  const c={SPAWN:0,INC:0,TENT1:0,TENT2:0,TENT3:0,CONTAM:0};
  scanLog.filter(e=>e.batch===id).forEach(e=>{
    const tz=toZone(e.to),fz=toZone(e.from);
    if(e.action==='ADD'&&e.to&&c[tz]!==undefined)c[tz]=Math.max(0,c[tz]+1);
    if(e.action==='MOVE'){if(e.from&&c[fz]!==undefined)c[fz]=Math.max(0,c[fz]-1);if(e.to&&c[tz]!==undefined)c[tz]++}
    if(e.action==='REMOVE'&&e.from&&c[fz]!==undefined)c[fz]=Math.max(0,c[fz]-1);
  });
  const total=Object.values(c).reduce((a,b)=>a+b,0);
  let status='EMPTY',action='';
  if(c.TENT1+c.TENT2+c.TENT3>0){status='FRUITING';action=t('status.action.harvest')}
  else if(c.INC>0){status='INCUBATING';action=t('status.action.moveTent')}
  else if(c.SPAWN>0){status='SPAWN RUN';action=t('status.action.monitorSpawn')}
  else if(c.CONTAM>0){status='CONTAM';action=t('status.action.discard')}
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
  const stages=[
    {label:'SPAWN',color:'#8b5cf6'},
    {label:'INC',color:'#3b82f6'},
    {label:'TENT',color:'#22c55e'},
    {label:'DONE',color:'#e5e3dd'},
    {label:'CONTAM',color:'#ef4444'}
  ];
  const counts={SPAWN:0,INC:0,TENT:0,DONE:0,CONTAM:0};
  batches.forEach(b=>{
    const{c,status}=getStatus(b.batchId);
    counts.SPAWN+=c.SPAWN;counts.INC+=c.INC;
    counts.TENT+=c.TENT1+c.TENT2+c.TENT3;counts.CONTAM+=c.CONTAM;
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
  const data=labels.map(s=>bySpecies[s]);
  const colors=labels.map(s=>spColor(s));
  if(harvestChartInst){harvestChartInst.destroy();harvestChartInst=null}
  if(!labels.length){canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);const ctx=canvas.getContext('2d');ctx.fillStyle='#aaa';ctx.font='12px system-ui';ctx.textAlign='center';ctx.fillText(t('harvest.noData'),canvas.width/2,80);return}
  harvestChartInst=new Chart(canvas,{
    type:'bar',
    data:{labels,datasets:[{data,backgroundColor:colors,borderRadius:5,borderSkipped:false}]},
    options:{responsive:true,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>ctx.parsed.y+'g'}}},scales:{y:{ticks:{callback:v=>v+'g',color:'#64748b'},grid:{color:'#f1f5f9'}},x:{grid:{display:false},ticks:{color:'#64748b'}}}}
  });
}

const ZONE_LABELS={SPAWN:'dash.zoneSpawn',INC:'dash.zoneInc',TENT1:'dash.zoneTent1',TENT2:'dash.zoneTent2',TENT3:'dash.zoneTent3',CONTAM:'dash.zoneContam'};
const ZONE_COLORS={SPAWN:'#8b5cf6',INC:'#3b82f6',TENT1:'#22c55e',TENT2:'#22c55e',TENT3:'#22c55e',CONTAM:'#ef4444'};
function rackLabel(id){const m=id.match(/\d+$/);return m?t('dash.rackN',{n:m[0]}):id.replace(/_/g,' ')}

function renderStatus(){
  const q=(document.getElementById('status-q')?.value||'').toLowerCase();
  const el=document.getElementById('dash-locations');
  if(!el)return;
  if(!batches.length){el.innerHTML='<div class="empty">'+t('dash.noBatches')+'</div>';renderMetrics(0,0,0,0);renderPipelineChart();renderHarvestChart();return}

  // Compute per-batch status
  let ti=0,tt=0,tc=0;
  const batchData=batches.map(b=>{
    const{c,total,status}=getStatus(b.batchId);
    ti+=c.INC;tt+=c.TENT1+c.TENT2+c.TENT3;tc+=c.CONTAM;
    const harv=getHarvested(b.batchId);
    const due=new Date(b.due);
    const ov=due<new Date()&&(c.INC>0||c.SPAWN>0);
    return{b,c,total,status,harv,due,ov};
  });

  // Filter by search
  const filtered=batchData.filter(d=>!q||d.b.batchId.toLowerCase().includes(q)||d.b.species.toLowerCase().includes(q)||d.b.strain.toLowerCase().includes(q));

  let html='';
  // ── Spawn Run section ──
  html+=renderRackSection('SPAWN',SPAWN_RACKS,filtered);
  // ── Incubation section ──
  html+=renderRackSection('INC',INC_RACKS,filtered);
  // ── Fruiting Tents section ──
  html+=renderTentsSection(filtered);
  // ── Contaminated section (only if bags exist) ──
  const contamBags=getZoneBags('CONTAM');
  if(Object.keys(contamBags).length>0)html+=renderContamSection(filtered);

  el.innerHTML=html;
  renderMetrics(batches.length,ti,tt,tc);
  renderPipelineChart();
  renderHarvestChart();
  updateActionBar();
}

function renderRackSection(zone,racks,filtered){
  const color=ZONE_COLORS[zone];
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
      return`<div class="batch-card${ov?' batch-overdue':''}" onclick="this.classList.toggle('expanded')">
        <div class="batch-card-header">
          <span class="batch-card-species">${spDot(d.sp)}${esc(d.sp)}</span>
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

  const gridClass=zone==='INC'?'rack-grid rack-grid-5col':'rack-grid';
  return`<div class="location-section">
    <div class="location-section-header">
      <div class="location-section-title"><span class="zone-dot" style="background:${color}"></span>${t(ZONE_LABELS[zone])}</div>
      <span class="location-section-count">${tp('dash.bags',totalBags)}</span>
    </div>
    <div class="${gridClass}">${rackCards}</div>
  </div>`;
}

function renderTentsSection(filtered){
  const tents=['TENT1','TENT2','TENT3'];
  let totalBags=0;
  tents.forEach(tz=>totalBags+=Object.keys(getZoneBags(tz)).length);
  const q=(document.getElementById('status-q')?.value||'').toLowerCase();

  const tentCols=tents.map(tz=>{
    const bags=getZoneBags(tz);
    const entries=Object.entries(bags);
    const byBatch={};
    entries.forEach(([bagId,d])=>{
      if(!byBatch[d.batchId])byBatch[d.batchId]={sp:d.species,st:d.strain,bags:[]};
      byBatch[d.batchId].bags.push({id:bagId,loc:d.loc});
    });
    const batchEntries=Object.entries(byBatch).filter(([bid,d])=>!q||bid.toLowerCase().includes(q)||d.sp.toLowerCase().includes(q)||d.st.toLowerCase().includes(q));

    if(!batchEntries.length){
      return`<div class="tent-column">
        <div class="tent-column-header">${t(ZONE_LABELS[tz])}</div>
        <div class="tent-column-empty">${t('dash.empty')}</div>
      </div>`;
    }
    const cards=batchEntries.map(([bid,d])=>{
      const bd=filtered.find(f=>f.b.batchId===bid);
      const harv=bd?bd.harv:0;
      const due=bd?bd.due:null;
      const ov=bd?bd.ov:false;
      d.bags.sort((a,b)=>(parseInt(a.id.split('-').pop())||0)-(parseInt(b.id.split('-').pop())||0));
      return`<div class="batch-card${ov?' batch-overdue':''}" onclick="this.classList.toggle('expanded')">
        <div class="batch-card-header">
          <span class="batch-card-species">${spDot(d.sp)}${esc(d.sp)}</span>
          <span class="batch-card-count">${d.bags.length}</span>
        </div>
        <div class="batch-card-meta">
          <span style="font-family:monospace;font-size:10px">${esc(bid)}</span>
          <span>${esc(d.st)}</span>
          ${harv>0?`<span style="color:#92400e;font-weight:500">${t('dash.harvested')}: ${harv}g</span>`:''}
          ${due?`<span style="color:${ov?'#b91c1c':'var(--c-text-muted)'}">${t('dash.due')}: ${fmtDt(due)}${ov?' \u26a0':''}</span>`:''}
        </div>
        <div class="batch-card-chips">${d.bags.map(bg=>{
          const sel=selectedLocBags.has(bg.id);
          return`<span class="bag-chip${sel?' selected':''}" data-bag="${esc(bg.id)}" data-batch="${esc(bid)}" data-loc="${esc(bg.loc)}">${bg.id.split('-').pop()}</span>`;
        }).join('')}</div>
      </div>`;
    }).join('');
    return`<div class="tent-column">
      <div class="tent-column-header">${t(ZONE_LABELS[tz])} <span style="font-size:11px;font-weight:400;color:var(--c-text-muted)">(${entries.length})</span></div>
      ${cards}
    </div>`;
  }).join('');

  return`<div class="location-section">
    <div class="location-section-header">
      <div class="location-section-title"><span class="zone-dot" style="background:#22c55e"></span>${t('dash.fruitingTents')}</div>
      <span class="location-section-count">${tp('dash.bags',totalBags)}</span>
    </div>
    <div class="tent-columns">${tentCols}</div>
  </div>`;
}

function renderContamSection(filtered){
  const bags=getZoneBags('CONTAM');
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
    return`<div class="batch-card" onclick="this.classList.toggle('expanded')">
      <div class="batch-card-header">
        <span class="batch-card-species">${spDot(d.sp)}${esc(d.sp)}</span>
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
      <div class="location-section-title"><span class="zone-dot" style="background:#ef4444"></span>\u26a0 ${t(ZONE_LABELS.CONTAM)}</div>
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
  // Select all bags visible across all zones
  ZONES.forEach(z=>{
    const bags=getZoneBags(z);
    Object.entries(bags).forEach(([bagId,d])=>selectedLocBags.set(bagId,{batchId:d.batchId,loc:d.loc}));
  });
  renderStatus();
}
function renderDashAlerts(){
  const invAlerts=getInvAlerts();
  const card=document.getElementById('dash-alerts-card');
  const el=document.getElementById('dash-alerts');
  if(!invAlerts.length){card.style.display='none';return}
  card.style.display='';
  el.innerHTML=invAlerts.map(tk=>`<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;font-size:12px;border-radius:6px;margin-bottom:3px;background:${tk.urgent?'#fef2f2':'#fffbeb'};border-left:3px solid ${tk.urgent?'#dc2626':'#f59e0b'}"><div style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(tk.text)}</div><button class="btn btn-sm" onclick="go('inv','n-inv')" style="font-size:11px;padding:2px 8px">${t('inv.stock')}</button></div>`).join('');
}
function renderDashBatchTasks(){
  const filter=document.getElementById('dash-batch-filter')?.value||'all';
  const tasks=buildAutoTasks();
  const shown=filter==='urgent'?tasks.filter(tk=>tk.urgent||tk.warn):tasks;
  const el=document.getElementById('dash-batch-tasks');
  if(!el)return;
  if(!tasks.length){el.innerHTML='<div class="empty" style="padding:12px;text-align:center;color:var(--c-text-muted);font-size:13px">'+t('dash.noUrgent')+'</div>';return}
  el.innerHTML=shown.length?shown.map(tk=>'<div class="todo-row '+(tk.urgent?'urgent':tk.warn?'warn':'')+'" style="padding:6px 8px;margin-bottom:3px">'
    +(tk.urgent?'<span class="pdot high"></span>':tk.warn?'<span class="pdot med"></span>':'')
    +'<div style="flex:1"><div style="font-size:13px;font-weight:500">'+spDot(tk.species)+esc(tk.text)+'</div>'
    +'<div style="font-size:11px;color:#888;margin-top:1px">'+esc(tk.detail)+'</div></div></div>').join('')
    :'<div class="empty" style="padding:12px;text-align:center;color:var(--c-text-muted);font-size:13px">'+t('dash.noUrgent')+'</div>';
}

// ─── RACKS ───────────────────────────────────────────────────
function getRackBags(rackId){
  const bags={};
  scanLog.forEach(e=>{
    if(e.action==='ADD'&&e.to===rackId&&e.bag)bags[e.bag]={batchId:e.batch,species:e.species,strain:e.strain};
    if(e.action==='MOVE'){if(e.to===rackId&&e.bag)bags[e.bag]={batchId:e.batch,species:e.species,strain:e.strain};if(e.from===rackId&&e.bag)delete bags[e.bag];}
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
    if(e.action==='MOVE'){
      if(tz===zone&&e.bag)bags[e.bag]={batchId:e.batch,species:e.species,strain:e.strain,loc:e.to};
      if(fz===zone&&e.bag)delete bags[e.bag];
    }
    if(e.action==='REMOVE'&&e.bag&&bags[e.bag])delete bags[e.bag];
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
  grid.innerHTML='<div style="font-size:11px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:.05em;width:100%;margin-bottom:2px">'+t('dash.zones')+'</div>'
    +ZONES.map(z=>`<button class="btn btn-sm" onclick="locPreConfirm('${z}')" style="font-size:12px;padding:8px 12px">${t(ZONE_LABELS[z])}</button>`).join('')
    +'<div style="font-size:11px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:.05em;width:100%;margin-top:8px;margin-bottom:2px">'+t('dash.racks')+'</div>'
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
    <div style="font-size:11px;color:#888;margin-bottom:8px;font-family:monospace">${preview}</div>
    <div style="font-size:20px;margin-bottom:16px">${fromLabel} \u2192 <strong>${toLoc}</strong></div>
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
    const entry={time:now,action:'MOVE',batch:d.batchId,bag:bagId,from:d.loc,to:toLoc,species:null,strain:null,user:currentUser?.username||null};scanLog.push(entry);movements.push(entry);entries.push(entry);
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
    const entry={time:now,action:'REMOVE',batch:d.batchId,bag:bagId,from:d.loc,to:null,user:currentUser?.username||null};scanLog.push(entry);movements.push(entry);entries.push(entry);
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
function nbTypeChange(){
  const isGrain=document.getElementById('nb-type').value==='grain';
  // Toggle weight buttons
  document.getElementById('wbtn-3').style.display=isGrain?'none':'';
  document.getElementById('wbtn-5').style.display=isGrain?'none':'';
  document.getElementById('wbtn-07').style.display=isGrain?'':'none';
  document.getElementById('wbtn-1').style.display=isGrain?'':'none';
  document.getElementById('wbtn-2').style.display=isGrain?'':'none';
  document.getElementById('wbtn-5g').style.display=isGrain?'':'none';
  // Toggle substrate section (grain doesn't need it)
  document.querySelector('details').style.display=isGrain?'none':'';
  // Set default weight
  document.getElementById('nb-weight').value=isGrain?'1':'3';
  setBagWeight(isGrain?1:3);
  nbPreview();
}
function setBagWeight(kg){
  document.getElementById('nb-weight').value=kg;
  // Highlight the active button
  ['wbtn-3','wbtn-5','wbtn-07','wbtn-1','wbtn-2','wbtn-5g'].forEach(id=>{
    const btn=document.getElementById(id);
    if(!btn)return;
    const btnKg=parseFloat(btn.textContent);
    btn.className='btn btn-sm'+(btnKg===kg?' btn-p':'');
  });
  nbPreview();
}
function nbPreview(){
  const sp=document.getElementById('nb-sp').value.trim(),st=document.getElementById('nb-st').value.trim();
  const qty=parseInt(document.getElementById('nb-qty').value)||0;
  document.getElementById('nb-prev').textContent=(sp&&st)?genBatchId(sp)+' ('+qty+' bags)':'—';
  const isGrain=document.getElementById('nb-type').value==='grain';
  const bagKg=parseFloat(document.getElementById('nb-weight').value)||0;
  if(!qty||!bagKg){document.getElementById('nb-mat-preview').style.display='none';return}
  let lines=[];
  if(isGrain){
    const totalGrain=qty*bagKg;
    const avail=inventory.stock?.grain||0;
    const enough=avail>=totalGrain;
    lines.push(`<strong>Grain needed:</strong> ${totalGrain.toFixed(2)} kg (${qty} × ${bagKg} kg)`);
    lines.push(`In stock: ${avail.toFixed(2)} kg → ${enough?'✓ sufficient':'⚠ only enough for '+Math.floor(avail/bagKg)+' bags'}`);
  }else{
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
  const sp=document.getElementById('nb-sp').value.trim(),st=document.getElementById('nb-st').value.trim();
  const qty=parseInt(document.getElementById('nb-qty').value)||0,days=parseInt(document.getElementById('nb-days').value)||14;
  const isGrain=document.getElementById('nb-type').value==='grain';
  const bagKg=parseFloat(document.getElementById('nb-weight').value)||0;
  if(!sp||!st||qty<1){alert('Please fill in species, strain and quantity');return}
  if(!bagKg){alert('Please enter a bag weight');return}
  const hw=parseFloat(document.getElementById('nb-hw').value)||0,wb=parseFloat(document.getElementById('nb-wb').value)||0;
  const substrate=(!isGrain&&(hw||wb))?{hardwood:hw,wheatbran:wb,rh:parseFloat(document.getElementById('nb-rh').value)||null,gypsum:document.getElementById('nb-gyp').checked}:null;
  const batchId=genBatchId(sp);spColor(sp);
  const due=new Date();due.setDate(due.getDate()+days);
  const bags=Array.from({length:qty},(_,i)=>batchId+'-'+String(i+1).padStart(2,'0'));
  const batchType=isGrain?'grain':'block';
  batches.push({batchId,species:sp,strain:st,qty,days,substrate,bagKg,batchType,sourceId:document.getElementById('nb-culture').value||null,notes:document.getElementById('nb-notes').value.trim(),created:new Date().toISOString(),due:due.toISOString(),bags});

  // Save batch to server
  const batchObj=batches[batches.length-1];
  apiPost('/api/batches',batchObj);

  // Auto-deduct materials from inventory via server-side deltas
  if(!inventory.stock)inventory.stock={hardwood:0,wheatbran:0,gypsum:0,grain:0};
  const deltas=[];
  if(isGrain){
    const grainUsed=qty*bagKg;
    inventory.stock.grain=Math.max(0,inventory.stock.grain-grainUsed);
    deltas.push({mat:'grain',deltaKg:-grainUsed,type:'batch',ref:batchId});
  }else if(substrate){
    const rh=parseFloat(document.getElementById('nb-rh').value)||0;
    const dryKgPerBag=rh>0?bagKg*(1-rh/100):bagKg;
    const hwUsed=qty*dryKgPerBag*(hw/100);
    const wbUsed=qty*dryKgPerBag*(wb/100);
    if(hwUsed>0){inventory.stock.hardwood=Math.max(0,inventory.stock.hardwood-hwUsed);deltas.push({mat:'hardwood',deltaKg:-hwUsed,type:'batch',ref:batchId})}
    if(wbUsed>0){inventory.stock.wheatbran=Math.max(0,inventory.stock.wheatbran-wbUsed);deltas.push({mat:'wheatbran',deltaKg:-wbUsed,type:'batch',ref:batchId})}
    if(substrate.gypsum){const gypUsed=qty*dryKgPerBag*0.01;inventory.stock.gypsum=Math.max(0,inventory.stock.gypsum-gypUsed);deltas.push({mat:'gypsum',deltaKg:-gypUsed,type:'batch',ref:batchId})}
  }
  if(deltas.length)invDeltas(deltas);
  document.getElementById('nb-bags').innerHTML=bags.map(b=>`<span style="font-size:10px;font-family:monospace;background:#f5f4f0;padding:2px 6px;border-radius:4px;color:#555">${esc(b)}</span>`).join('');
  document.getElementById('nb-result').style.display='block';
  document.getElementById('nb-sp').value='';document.getElementById('nb-st').value='';
  document.getElementById('nb-qty').value='10';document.getElementById('nb-days').value='14';
  document.getElementById('nb-notes').value='';document.getElementById('nb-mat-preview').style.display='none';
  nbPreview();updateTodoBadge();
}
function goToPrintBatch(){go('print','n-print');setTimeout(()=>{openStab('print','bags');fillBatchSelect();const s=document.getElementById('print-batch'),last=batches[batches.length-1];if(last){s.value=last.batchId;renderBagPreview()}},100)}
function renderBatches(){
  const q=(document.getElementById('batch-q').value||'').toLowerCase(),body=document.getElementById('batches-body');
  if(!batches.length){body.innerHTML='<tr><td colspan="12" class="empty">'+t('dash.noBatches')+'</td></tr>';return}
  body.innerHTML=batches.filter(b=>!q||b.batchId.toLowerCase().includes(q)||b.species.toLowerCase().includes(q)||b.strain.toLowerCase().includes(q)).map(b=>{
    const{status}=getStatus(b.batchId);
    const sub=b.substrate?[`<span class="sub-tag">HW ${b.substrate.hardwood}% WB ${b.substrate.wheatbran}%</span>`,b.substrate.rh?`<span class="sub-tag">RH ${b.substrate.rh}%</span>`:'',b.substrate.gypsum?`<span class="sub-tag" style="background:#f0fdf4;color:#166534">Gypsum</span>`:''].join(''):'<span style="color:#ccc;font-size:11px">—</span>';
    const src=b.sourceId?`<span style="font-family:monospace;font-size:10px;color:#6b21a8">${esc(b.sourceId)}</span>`:'<span style="color:#ccc;font-size:11px">—</span>';
    const note=b.notes?`<span style="font-size:11px;color:#555;cursor:pointer" data-action="open-note" data-batch="${esc(b.batchId)}">${esc(b.notes.length>22?b.notes.slice(0,22)+'\u2026':b.notes)}</span>`:`<span style="font-size:11px;color:#bbb;cursor:pointer;font-style:italic" data-action="open-note" data-batch="${esc(b.batchId)}">${t('batch.addNote')}</span>`;
    return`<tr><td style="font-family:monospace;font-size:10px"><span data-action="toggle-bags" data-batch="${esc(b.batchId)}" style="cursor:pointer;user-select:none" id="btog-${esc(b.batchId)}">&#9654;</span> ${esc(b.batchId)}</td><td>${spDot(b.species)}${esc(b.species)}</td><td>${esc(b.strain)}</td><td>${b.qty}</td><td>${b.days}d</td><td>${sub}</td><td>${src}</td><td style="font-size:10px;color:#888">${fmtDt(b.created)}</td><td style="font-size:10px;color:#888">${fmtDt(b.due)}</td><td>${sbadge(status)}</td><td>${note}</td><td style="white-space:nowrap"><button class="btn btn-sm" data-action="add-bags" data-batch="${esc(b.batchId)}" style="margin-right:3px">${t('batch.addBags')}</button><button class="btn btn-sm btn-r" data-action="del-batch" data-batch="${esc(b.batchId)}">${t('batch.del')}</button></td></tr>`;
  }).join('')||'<tr><td colspan="12" class="empty">'+t('dash.noMatches')+'</td></tr>';
}
const locColor={SPAWN:'#8b5cf6',INC:'#3b82f6',TENT1:'#22c55e',TENT2:'#22c55e',TENT3:'#22c55e',CONTAM:'#ef4444'};
function toggleBatchBags(batchId){
  const existing=document.getElementById('brow-'+batchId);
  if(existing){existing.remove();document.getElementById('btog-'+batchId).innerHTML='&#9654;';return}
  const b=batches.find(x=>x.batchId===batchId);if(!b)return;
  document.getElementById('btog-'+batchId).innerHTML='&#9660;';
  const parentRow=document.getElementById('btog-'+batchId).closest('tr');
  const tr=document.createElement('tr');tr.id='brow-'+batchId;
  const td=document.createElement('td');td.colSpan=12;td.style.cssText='background:#f9f8f5;padding:8px 12px';
  td.innerHTML='<div style="display:flex;flex-wrap:wrap;gap:4px">'+b.bags.map(bag=>{
    const last=[...scanLog].reverse().find(e=>(e.bag||'').toUpperCase()===bag.toUpperCase());
    let loc='—',color='#aaa';
    if(last){
      if(last.action==='REMOVE'){loc=t('bagInfo.removed');color='#999'}
      else if(last.to){loc=last.to;const z=toZone(last.to);color=locColor[z]||'#888'}
    }
    const num=bag.split('-').pop();
    return`<span style="font-size:10px;font-family:monospace;padding:3px 7px;border-radius:5px;background:#fff;border:1px solid #e5e3dd;display:inline-flex;align-items:center;gap:3px${last&&last.action==='REMOVE'?';text-decoration:line-through;opacity:.5':''}">
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
  apiPatch('/api/batches/'+encodeURIComponent(b.batchId)+'/bags',{add:newBags,newQty:b.qty});
  // Switch to result phase
  document.getElementById('ab-phase-input').style.display='none';
  document.getElementById('m-addbags-title').textContent=t('addBags.addedTitle');
  document.getElementById('ab-result-info').textContent=t('addBags.added',{qty:qty,id:b.batchId,total:b.bags.length});
  document.getElementById('ab-new-bags').innerHTML=newBags.map(id=>
    '<span style="font-size:10px;font-family:monospace;background:#f5f4f0;padding:2px 6px;border-radius:4px;color:#555">'+esc(id)+'</span>'
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

function delBatch(id){confirm2(t('batch.deleteBatch',{id:id}),t('batch.deleteMsg'),t('batch.deleteBtn'),()=>{batches=batches.filter(b=>b.batchId!==id);apiDelete('/api/batches/'+encodeURIComponent(id));renderBatches();renderStatus()})}

// ─── HARVESTS ────────────────────────────────────────────────
function showHarvestPanel(bagId,batchId){
  const b=batches.find(x=>x.batchId===batchId);
  scan.harvestBag={bagId,batchId,species:b?.species,strain:b?.strain};
  document.getElementById('hp-lbl').textContent=t('harvest.logHarvest')+' \u2014 '+bagId;
  document.getElementById('hp-bag').value=bagId;document.getElementById('hp-grams').value='';
  closeScanModal();
  document.getElementById('harvest-panel').style.display='block';
  setTimeout(()=>document.getElementById('hp-grams').focus(),80);
  setFb('harvest',t('harvest.bagScanned',{bag:bagId}),{noModal:true});
}
function confirmHarvest(){
  const g=parseFloat(document.getElementById('hp-grams').value),f=parseInt(document.getElementById('hp-flush').value)||1;
  if(!g||g<=0){alert(t('harvest.enterWeight'));return}
  const p=scan.harvestBag;
  const hEntry={time:new Date().toISOString(),batch:p.batchId,bag:p.bagId,species:p.species,strain:p.strain,grams:g,flush:f};
  harvests.push(hEntry);apiPost('/api/harvests',hEntry);scan.harvestBag=null;scan.count++;
  document.getElementById('harvest-panel').style.display='none';
  setFb('ok',t('harvest.logged',{bag:p.bagId,g:g,f:f}));updateSD();
}
function cancelHarvest(){scan.harvestBag=null;document.getElementById('harvest-panel').style.display='none';setFb('info',t('harvest.cancelled'))}
document.getElementById('hp-grams').addEventListener('keydown',e=>{if(e.key==='Enter')confirmHarvest()});
function renderHarvests(){
  const q=(document.getElementById('harvest-q').value||'').toLowerCase(),body=document.getElementById('harvest-body');
  const items=[...harvests].reverse().filter(h=>!q||h.batch.toLowerCase().includes(q)||(h.species||'').toLowerCase().includes(q)).slice(0,200);
  body.innerHTML=items.length?items.map(h=>`<tr><td style="font-size:10px;color:#aaa">${fmtDtTime(h.time)}</td><td style="font-family:monospace;font-size:10px">${esc(h.batch)||'\u2014'}</td><td style="font-family:monospace;font-size:10px">${esc(h.bag)||'\u2014'}</td><td>${h.species?spDot(h.species)+esc(h.species):'\u2014'}</td><td>${esc(h.strain)||'\u2014'}</td><td>${h.flush||1}</td><td style="font-weight:500;color:#92400e">${h.grams}g</td></tr>`).join(''):'<tr><td colspan="7" class="empty">'+t('harvest.noHarvests')+'</td></tr>';

  const byBatch={};
  harvests.forEach(h=>{if(!byBatch[h.batch])byBatch[h.batch]={total:0,flushes:{},species:h.species};byBatch[h.batch].total+=h.grams;byBatch[h.batch].flushes[h.flush]=(byBatch[h.batch].flushes[h.flush]||0)+h.grams});
  const ids=Object.keys(byBatch).sort((a,b)=>byBatch[b].total-byBatch[a].total);
  const tot=harvests.reduce((s,h)=>s+h.grams,0);
  document.getElementById('harvest-metrics').innerHTML=ids.length?[
    [t('harvest.totalHarvested'),tot>=1000?(tot/1000).toFixed(1)+'kg':tot+'g'],
    [t('harvest.batchesWithYield'),ids.length],
    [t('harvest.topBatch'),ids[0]?byBatch[ids[0]].total+'g':'\u2014']
  ].map(([l,v])=>`<div class="met"><div class="met-l">${l}</div><div class="met-v" style="font-size:16px;color:#92400e">${v}</div></div>`).join(''):'';

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
    return`<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px"><span style="font-size:12px;font-weight:500">${spDot(d.species)}${esc(id)}</span><span style="font-size:13px;font-weight:600;color:#92400e">${d.total}g</span></div><div class="harvest-bar"><div class="harvest-bar-fill" style="width:${pct}%"></div></div><div style="font-size:10px;color:#888;margin-top:2px">${Object.entries(d.flushes).map(([f,g])=>`Flush ${f}: ${g}g`).join(' · ')}</div></div>`;
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
  if(!teamMembers.length){el.innerHTML='<div class="empty" style="padding:1rem">No team members yet. Add your first member below.</div>';return}
  el.innerHTML=teamMembers.map(m=>`<div class="member-row"><span class="name">${esc(m.name)}</span>${m.role?`<span style="font-size:11px;color:#888">${esc(m.role)}</span>`:''}<button class="btn btn-sm btn-r" onclick="removeMember(${m.id})">×</button></div>`).join('');
}
function addMember(){
  const name=document.getElementById('member-name').value.trim();if(!name)return;
  const role=document.getElementById('member-role').value.trim();
  if(teamMembers.some(m=>m.name.toLowerCase()===name.toLowerCase()))return;
  const member={name,role:role||null,added:new Date().toISOString()};
  teamMembers.push(member);
  document.getElementById('member-name').value='';document.getElementById('member-role').value='';
  apiPost('/api/team',member).then(r=>{if(r.id)member.id=r.id});renderTeam();
}
function removeMember(id){const m=teamMembers.find(x=>x.id===id);if(!m)return;confirm2('Remove member?','Remove '+m.name+' from the team. Their existing task assignments remain.','Remove',()=>{teamMembers=teamMembers.filter(x=>x.id!==id);apiDelete('/api/team/'+id);renderTeam()})}

// ─── CalDAV SYNC ────────────────────────────────────────────
function loadCaldavSettings(){
  // Show the CalDAV URL for this server
  const url=location.protocol+'//'+location.hostname+':'+location.port+'/caldav/calendars/';
  document.getElementById('caldav-url-display').textContent=url;
  document.getElementById('caldav-user').value=caldav.caldavUsername||'';
  document.getElementById('caldav-pass').value=caldav.caldavPassword||'';
  document.getElementById('caldav-enabled').checked=!!caldav.enabled;
  document.getElementById('caldav-per-person').checked=!!caldav.perPersonCalendars;
}
function saveCaldavSettings(){
  caldav.caldavUsername=document.getElementById('caldav-user').value.trim();
  caldav.caldavPassword=document.getElementById('caldav-pass').value;
  caldav.enabled=document.getElementById('caldav-enabled').checked;
  caldav.perPersonCalendars=document.getElementById('caldav-per-person').checked;
  apiPost('/api/caldav/config',caldav);
  showCaldavStatus('Settings saved.','#166534');
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
    if(r.error){showCaldavStatus('Sync failed: '+r.error,'#b91c1c')}
    else{
      showCaldavStatus(`Done! ${r.pushed} tasks written to calendar.${r.errors?' ('+r.errors+' errors)':''}  Calendar clients can now see them via CalDAV.`, r.errors?'#92400e':'#166534');
      // Selective refresh: only reload tasks to get updated caldavUid/caldavSynced
      // instead of loadData() which would overwrite ALL local state
      try{const td=await authFetch('/api/data').then(r=>r.json());if(td.manualTasks)manualTasks=td.manualTasks;if(td.calendarEvents)calendarEvents=td.calendarEvents}catch{}
      renderCalendar();
    }
  }catch(e){showCaldavStatus('Sync error: '+e.message,'#b91c1c')}
  finally{btn.disabled=false;btn.textContent='Sync all tasks now'}
}
async function pushTaskCaldav(task){
  if(!caldav.enabled)return;
  try{
    const r=await authFetch('/api/caldav/push-one',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({task})}).then(r=>r.json());
    if(r.ok&&r.uid){task.caldavUid=r.uid;task.caldavSynced=new Date().toISOString();apiPatch('/api/tasks/'+task.id,{caldavUid:task.caldavUid,caldavSynced:task.caldavSynced});renderCalendar()}
  }catch(e){console.error('CalDAV push error:',e)}
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
    return `<tr><td style="font-size:10px;color:#aaa">${fmtDtTime(e.time)}</td><td style="font-size:11px">${esc(e.user)||'\u2014'}</td><td><span class="badge ${e.action==='ADD'?'b-add':e.action==='REMOVE'?'b-remove':e.action==='HARVEST'?'b-harvest':'b-move'}">${esc(e.action)}</span></td><td style="font-family:monospace;font-size:10px">${esc(e.batch)||'\u2014'}</td><td style="font-family:monospace;font-size:10px">${esc(e.bag)||'\u2014'}</td><td>${esc(e.from)||'\u2014'}</td><td>${esc(e.to)||'\u2014'}</td><td>${e.species?spDot(e.species)+esc(e.species):'\u2014'}</td><td>${isRecent?'<button class="btn-xs" style="padding:2px 6px;font-size:10px" onclick="deleteLogEntry(this,\''+esc(e.time)+'\',\''+esc(e.batch)+'\',\''+esc(e.action)+'\')" title="Löschen">✕</button>':''}</td></tr>`}).join(''):'<tr><td colspan="9" class="empty">'+t('settings.noScans')+'</td></tr>';
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
      : `≈ <strong>${bags}</strong> × ${bagKg}kg blocks <span style="font-size:10px;color:#aaa">(avg estimate)</span>`;
    return`<div style="background:${MAT_BG[mat]};border:1px solid ${low?'#f87171':MAT_BORDER[mat]};border-radius:10px;padding:14px 16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div style="font-size:12px;font-weight:600;color:${MAT_COLORS[mat]}">${MAT_LABELS[mat]}</div>
        ${low?`<span style="font-size:10px;background:#fee2e2;color:#991b1b;padding:2px 7px;border-radius:99px;font-weight:600">LOW STOCK</span>`:''}
      </div>
      <div style="font-size:26px;font-weight:700;color:#1a1a1a;margin-bottom:2px">${stock.toFixed(1)} <span style="font-size:14px;font-weight:400;color:#888">kg</span></div>
      <div style="height:5px;border-radius:3px;background:rgba(0,0,0,.08);overflow:hidden;margin-bottom:8px">
        <div style="height:100%;border-radius:3px;background:${low?'#f87171':MAT_COLORS[mat]};width:${pct}%;transition:width .3s"></div>
      </div>
      <div style="font-size:12px;color:#555;line-height:1.6">${estNote}</div>
      ${thresh.minKg>0?`<div style="font-size:11px;color:${low?'#b91c1c':'#aaa'};margin-top:2px">Alert below ${thresh.minKg}kg</div>`:''}
      <button class="btn btn-sm" onclick="openStab('inv','delivery')" style="margin-top:8px;font-size:11px">+ Log delivery</button>
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
        <td><input type="text" inputmode="decimal" value="${t.minKg}" style="width:80px;font-size:12px;padding:3px 6px" onchange="updateThreshold('${mat}','minKg',this.value)" /></td>
        <td style="font-size:12px;color:#666">~${bags} bags <span style="font-size:10px;color:#aaa">(avg)</span></td>
      </tr>`;
    }).join('')}
    </tbody>
  </table></div>`;

  // Average composition settings
  const compHtml=`<div style="background:#f9f8f5;border-radius:8px;padding:12px">
    <div style="font-size:11px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px">
      Average composition used for estimates
    </div>
    <p style="font-size:12px;color:#888;margin-bottom:10px;line-height:1.6">
      These averages are used to calculate "~X bags" on the stock cards. 
      They are <strong>estimates only</strong> — exact usage is tracked when you create a batch with a specific substrate recipe.
    </p>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">
      <div><label style="font-size:11px">Hardwood %</label>
        <input type="text" inputmode="decimal" value="${c.hwPct}" style="font-size:13px;padding:5px 8px" onchange="updateAvgComp('hwPct',this.value)" /></div>
      <div><label style="font-size:11px">Wheat bran %</label>
        <input type="text" inputmode="decimal" value="${c.wbPct}" style="font-size:13px;padding:5px 8px" onchange="updateAvgComp('wbPct',this.value)" /></div>
      <div><label style="font-size:11px">Water % (RH)</label>
        <input type="text" inputmode="decimal" value="${c.rhPct}" style="font-size:13px;padding:5px 8px" onchange="updateAvgComp('rhPct',this.value)" /></div>
      <div><label style="font-size:11px">Block weight (kg)</label>
        <input type="text" inputmode="decimal" value="${c.bagKg}" style="font-size:13px;padding:5px 8px" onchange="updateAvgComp('bagKg',this.value)" /></div>
      <div><label style="font-size:11px">Grain bag (kg)</label>
        <input type="text" inputmode="decimal" value="${c.grainBagKg}" style="font-size:13px;padding:5px 8px" onchange="updateAvgComp('grainBagKg',this.value)" /></div>
    </div>
    <div style="margin-top:8px;font-size:11px;color:#aaa">
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
    <td style="font-size:10px;color:#aaa">${fmtDtTime(e.time)}</td>
    <td style="color:${MAT_COLORS[e.mat]};font-weight:500">${MAT_LABELS[e.mat]}</td>
    <td style="font-weight:600;color:${e.deltaKg<0?'#991b1b':'#166534'}">${e.deltaKg>0?'+':''}${e.deltaKg.toFixed(2)} kg</td>
    <td style="font-size:11px">${(e.running||0).toFixed(1)} kg</td>
    <td><span class="badge ${e.type==='delivery'?'b-add':e.type==='adjustment'?'b-move':'b-harvest'}">${e.type}</span></td>
    <td style="font-size:11px;color:#666">${esc(e.ref)||'—'}</td>
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
    return{text:`Low stock: ${MAT_LABELS[mat]}`,detail:`${stock.toFixed(1)} kg remaining (≈${bags} bags) — below ${thresh}kg threshold`,urgent:stock<thresh*0.5,warn:true,species:null};
  });
}

// ─── BACKUP ──────────────────────────────────────────────────
function setStatus(el,msg,ok){el.style.color=ok?'#166534':'#b91c1c';el.textContent=msg}
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
      const r=await fetch('/api/backup/restore?pw='+encodeURIComponent(pw),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:buf});
      if(!r.ok){const e=await r.json().catch(()=>({}));setStatus(st,e.error||'Restore failed',false);return}
      setStatus(st,'Restored successfully. Reloading…',true);
      document.getElementById('backup-restore-pw').value='';
      setTimeout(()=>window.location.reload(),1500);
    }catch(err){setStatus(st,'Restore failed',false)}
  });
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
      <td style="font-size:11px;color:#555">${esc(a.location)||'—'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-sm" onclick="editAsset('${esc(a.assetId)}')" style="padding:2px 6px">Bearb.</button>
        <button class="btn btn-sm" onclick="quickPrintAsset('${esc(a.assetId)}')" style="padding:2px 6px">Druck</button>
        <button class="btn btn-sm" onclick="deleteAsset('${esc(a.assetId)}')" style="padding:2px 6px;color:#991b1b">×</button>
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
  document.getElementById('asset-loc-list').innerHTML=locs.map(l=>`<option value="${l}">`).join('');
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
    `<div style="font-size:12px;color:#555;margin-bottom:6px">Stichtag: ${fmtDE(ref)} — ${aktiv.length} aktive Anlagen</div>`+
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
      <span style="color:#555">${esc(a.name)}</span>
      <span style="color:#999;font-size:11px">${esc(a.category)}</span>
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
  return ids.map(id=>{
    const a=assets.find(x=>x.assetId===id);if(!a)return'';
    const bcVal=id.replace(/-/g,'_');
    const loc=(a.category||'')+(a.location?' / '+a.location:'');
    const nameTrunc=a.name.length>28?a.name.slice(0,26)+'..':a.name;
    return'^XA^PW400^LL240^CI28^LH0,0'+
      '^FO20,10^BY2,2.0,60^BCN,60,N,N,N^FD'+bcVal+'^FS'+
      '^FO8,78^A0N,28,28^FD'+id+'^FS'+
      '^FO8,110^A0N,20,20^FD'+nameTrunc+'^FS'+
      '^FO8,135^A0N,16,16^FD'+loc.slice(0,36)+'^FS'+
      '^XZ';
  }).filter(Boolean).join('\n');
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

// ─── CULTURES ────────────────────────────────────────────────
const ctBadge=t=>{const m={MC:'badge-mc',PD:'badge-pd',LC:'badge-lc',G2G:'badge-g2g'};return`<span class="badge ${m[t]||''}">${t}</span>`}
const csBadge=s=>{const m={active:'badge-active',stored:'badge-stored',used:'badge-used',contam:'badge-contam'};return`<span class="badge ${m[s]||''}">${s}</span>`}
function fillCultureSelect(id,types){const s=document.getElementById(id);if(!s)return;const cur=s.value;s.innerHTML='<option value="">— none —</option>'+cultures.filter(c=>(c.status==='active'||c.status==='stored')&&(!types||types.includes(c.type))).map(c=>`<option value="${esc(c.id)}">${esc(c.id)} — ${esc(c.species)}/${esc(c.strain)} (${esc(c.type)})</option>`).join('');if(cur)s.value=cur}
function renderCultures(){
  const type=document.getElementById('cult-type').value,stat=document.getElementById('cult-stat').value,body=document.getElementById('cultures-body');
  const rows=cultures.filter(c=>(type==='all'||c.type===type)&&(stat==='all'||c.status===stat)).sort((a,b)=>b.created.localeCompare(a.created));
  if(!rows.length){body.innerHTML='<tr><td colspan="9" class="empty">'+t('lab.noCultures')+'</td></tr>';return}
  body.innerHTML=rows.map(c=>`<tr><td style="font-family:monospace;font-size:11px;font-weight:500">${esc(c.id)}</td><td>${ctBadge(c.type)}</td><td>${spDot(c.species)}${esc(c.species)}</td><td>${esc(c.strain)||'\u2014'}</td><td style="font-family:monospace;font-size:10px;color:#888">${esc(c.parentId)||'\u2014'}</td><td style="font-size:10px;color:#888">${fmtDt(c.created)}</td><td>${csBadge(c.status)}</td><td style="font-size:11px;color:#555;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.notes)||'\u2014'}</td><td style="white-space:nowrap"><select onchange="setCultureStatus('${esc(c.id)}',this.value)" style="width:auto;font-size:11px;padding:2px 5px"><option value="active" ${c.status==='active'?'selected':''}>${t('lab.active')}</option><option value="stored" ${c.status==='stored'?'selected':''}>${t('lab.stored')}</option><option value="used" ${c.status==='used'?'selected':''}>${t('lab.usedUp')}</option><option value="contam" ${c.status==='contam'?'selected':''}>${t('lab.contaminated')}</option></select> <button class="btn btn-sm" onclick="quickPrintCulture('${esc(c.id)}')" title="${t('asset.print')}" style="padding:2px 6px">${t('asset.print')}</button></td></tr>`).join('');
}
function setCultureStatus(id,status){const c=cultures.find(x=>x.id===id);if(c){c.status=status;apiPatch('/api/cultures/'+encodeURIComponent(id),{status});renderCultures()}}

// ─── LAB WORK ────────────────────────────────────────────────
function lwUpdate(){
  const type=document.getElementById('lw-type').value;
  const dl=document.getElementById('sp-list');
  dl.innerHTML=[...new Set([...batches.map(b=>b.species),...cultures.map(c=>c.species)].filter(Boolean))].map(s=>`<option value="${s}">`).join('');
  const pr=document.getElementById('lw-parent-row'),sr=document.getElementById('lw-source-row'),ql=document.getElementById('lw-qty-lbl');
  if(type==='MC'){pr.style.display='none';sr.style.display='block';ql.textContent=t('lab.qtyTubes')}
  else if(type==='PD'){pr.style.display='block';document.getElementById('lw-parent-lbl').textContent=t('lab.parentMcPdLc');fillParentSelect(['MC','PD','LC']);sr.style.display='none';ql.textContent=t('lab.qtyDishes')}
  else if(type==='LC'){pr.style.display='block';document.getElementById('lw-parent-lbl').textContent=t('lab.sourcePdMc');fillParentSelect(['MC','PD']);sr.style.display='none';ql.textContent=t('lab.qtyFlasks')}
  else{pr.style.display='none';sr.style.display='none';ql.textContent=t('lab.qtyBags')}
  lwPreview();
}
function fillParentSelect(types){const s=document.getElementById('lw-parent');const cur=s.value;s.innerHTML='<option value="">— none / new isolation —</option>'+cultures.filter(c=>(c.status==='active'||c.status==='stored')&&types.includes(c.type)).map(c=>`<option value="${esc(c.id)}">${esc(c.id)} — ${esc(c.species)}/${esc(c.strain)}</option>`).join('');if(cur)s.value=cur}
function lwPreview(){
  const type=document.getElementById('lw-type').value,sp=document.getElementById('lw-sp').value.trim(),qty=parseInt(document.getElementById('lw-qty').value)||1;
  const box=document.getElementById('lw-prev-box'),prev=document.getElementById('lw-prev');
  if(!sp||type==='G2G'){box.style.display='none';return}
  const prefix=type+'-'+abbrev(sp)+'-'+todayStr()+'-';
  const existing=cultures.filter(c=>c.id.startsWith(prefix)).length;
  prev.textContent=Array.from({length:qty},(_,i)=>prefix+String(existing+i+1).padStart(2,'0')).join('\n');
  box.style.display='block';
}
// lw-sp and lw-qty input listeners moved to initEventListeners()
function logLabWork(){
  const type=document.getElementById('lw-type').value,sp=document.getElementById('lw-sp').value.trim(),st=document.getElementById('lw-st').value.trim();
  const parentId=document.getElementById('lw-parent')?.value||null,qty=parseInt(document.getElementById('lw-qty').value)||1;
  if(!sp){alert(t('lab.enterSpecies'));return}
  if(type==='G2G'){alert(t('lab.g2gNote'));return}
  const prefix=type+'-'+abbrev(sp)+'-'+todayStr()+'-';
  const existing=cultures.filter(c=>c.id.startsWith(prefix)).length;
  const newC=Array.from({length:qty},(_,i)=>({id:prefix+String(existing+i+1).padStart(2,'0'),type,species:sp,strain:st||'',parentId:parentId||null,source:document.getElementById('lw-source')?.value.trim()||null,status:'active',notes:document.getElementById('lw-notes').value.trim(),created:new Date().toISOString()}));
  cultures.push(...newC);apiPost('/api/cultures',{cultures:newC});
  document.getElementById('lw-notes').value='';document.getElementById('lw-qty').value='1';
  if(document.getElementById('lw-source'))document.getElementById('lw-source').value='';
  renderLabLog();fillCultureSelect('nb-culture',['PD','LC']);lwPreview();
  const ids=newC.map(c=>c.id).join(', ');
  if(confirm(t('lab.logged',{n:newC.length,type:type})+'\n'+ids+'\n\n'+t('lab.printNow'))){
    selectedLabIds=new Set(newC.map(c=>c.id));go('print','n-print');
    setTimeout(()=>{openStab('print','lab');renderLabList();renderLabPreview();},150);
  }
}
function renderLabLog(){const body=document.getElementById('lab-log-body');const rows=[...cultures].sort((a,b)=>b.created.localeCompare(a.created)).slice(0,50);body.innerHTML=rows.length?rows.map(c=>`<tr><td style="font-size:10px;color:#aaa">${fmtDt(c.created)}</td><td>${ctBadge(c.type)}</td><td style="font-family:monospace;font-size:11px">${esc(c.id)}</td><td style="font-family:monospace;font-size:10px;color:#888">${esc(c.parentId)||'\u2014'}</td><td>${spDot(c.species)}${esc(c.species)}${c.strain?' / '+esc(c.strain):''}</td></tr>`).join(''):'<tr><td colspan="5" class="empty">'+t('lab.noLabWork')+'</td></tr>'}

// ─── LINEAGE ─────────────────────────────────────────────────
function fillLineageSelect(){const s=document.getElementById('lineage-sel');const cur=s.value;s.innerHTML='<option value="">— select —</option>'+(cultures.length?`<optgroup label="Cultures">${cultures.map(c=>`<option value="C:${esc(c.id)}">${esc(c.id)} (${esc(c.type)} — ${esc(c.species)})</option>`).join('')}</optgroup>`:'')+( batches.length?`<optgroup label="Batches">${batches.map(b=>`<option value="B:${esc(b.batchId)}">${esc(b.batchId)} (${esc(b.species)})</option>`).join('')}</optgroup>`:'');if(cur)s.value=cur}
function buildTree(rootId,rootType){
  const getAnc=id=>{const c=cultures.find(x=>x.id===id);if(!c)return[];const node={id:c.id,type:c.type,species:c.species,strain:c.strain,status:c.status,created:c.created};if(c.parentId){const p=cultures.find(x=>x.id===c.parentId);if(p)return[...getAnc(c.parentId),node]}return[node]};
  const getDesc=(id,depth)=>{if(depth>6)return[];const ch=[];cultures.filter(c=>c.parentId===id).forEach(c=>ch.push({...c,harvest:0,children:getDesc(c.id,depth+1)}));batches.filter(b=>b.sourceId===id).forEach(b=>{const{status}=getStatus(b.batchId);ch.push({id:b.batchId,type:'BATCH',species:b.species,strain:b.strain,status,harvest:getHarvested(b.batchId),created:b.created,children:[]})});return ch};
  if(rootType==='C'){const anc=getAnc(rootId);const c=cultures.find(x=>x.id===rootId);if(!c)return null;const root={...anc[anc.length-1]||{id:c.id,type:c.type,species:c.species,strain:c.strain,status:c.status,created:c.created}};root.children=getDesc(rootId,0);if(anc.length>1){let tree=anc[0],cur=tree;for(let i=1;i<anc.length;i++){anc[i].children=i===anc.length-1?root.children:[];cur.children=[anc[i]];cur=anc[i]}return tree}return root}
  else{const b=batches.find(x=>x.batchId===rootId);if(!b)return null;const{status}=getStatus(b.batchId);const bn={id:b.batchId,type:'BATCH',species:b.species,strain:b.strain,status,harvest:getHarvested(b.batchId),created:b.created,children:[]};if(b.sourceId){const anc=getAnc(b.sourceId);if(anc.length){let tree=anc[0],cur=tree;for(let i=1;i<anc.length;i++){anc[i].children=[];cur.children=[anc[i]];cur=anc[i]}cur.children=[bn];return tree}}return bn}
}
const NODE_BG={MC:'#f3e8ff',PD:'#dbeafe',LC:'#dcfce7',BATCH:'#fff7ed'};
const NODE_BD={MC:'#c084fc',PD:'#93c5fd',LC:'#86efac',BATCH:'#fdba74'};
function treeHtml(node,depth){const ch=node.children?.length?`<div style="margin-left:${depth?20:0}px;padding-left:16px;border-left:2px solid #e5e3dd;margin-top:5px">${node.children.map(c=>treeHtml(c,depth+1)).join('')}</div>`:'';const harv=node.harvest>0?`<span class="badge b-harvest" style="margin-left:4px">${node.harvest}g</span>`:'';return`<div style="margin-bottom:5px"><div style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;background:${NODE_BG[node.type]||'#f5f4f0'};border:1px solid ${NODE_BD[node.type]||'#e5e3dd'};border-radius:7px;padding:5px 10px"><span style="font-size:10px;font-weight:600;color:#555">${esc(node.type)}</span><span style="font-family:monospace;font-size:12px;font-weight:600">${esc(node.id)}</span><span style="font-size:11px;color:#666">${esc(node.species)||''}${node.strain?' / '+esc(node.strain):''}</span><span style="font-size:10px;color:#888">${esc(node.status)||''}</span>${harv}<span style="font-size:10px;color:#aaa">${node.created?fmtDt(node.created):''}</span></div>${ch}</div>`}
function renderLineage(){const val=document.getElementById('lineage-sel').value,body=document.getElementById('lineage-body');if(!val){body.innerHTML='<div class="empty">Select a culture or batch above.</div>';return}const[type,id]=val.split(':');const tree=buildTree(id,type);body.innerHTML=tree?`<div style="padding:4px 0">${treeHtml(tree,0)}</div>`:'<div class="empty">No lineage data found.</div>'}

// ─── BAG INFO MODAL ──────────────────────────────────────────
let biBagId=null,biBatchId=null;
function openBagInfo(bagId,batchId,batch){
  biBagId=bagId;biBatchId=batchId;
  const b=batch||batches.find(x=>x.batchId.toUpperCase()===batchId.toUpperCase());
  const el=document.getElementById('bi-body');
  if(!b){el.innerHTML='<p style="color:#b91c1c">'+t('batch.notFound')+': '+esc(batchId)+'</p>';document.getElementById('m-baginfo').classList.add('open');return}
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
      <div class="met"><div class="met-l">${t('batch.strain')}</div><div style="font-size:15px;font-weight:600">${esc(b.strain)||'\u2014'}</div></div>
      <div class="met"><div class="met-l">${t('bagInfo.currentLocation')}</div><div style="font-size:15px;font-weight:600;color:#1e40af">${esc(currentLoc)}</div></div>
      <div class="met"><div class="met-l">${t('dash.totalHarvested')}</div><div style="font-size:15px;font-weight:600;color:#92400e">${totalHarv>0?totalHarv+'g':t('bagInfo.noneYet')}</div></div>
    </div>
    <div style="font-size:11px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">${t('batch.batchId')} ${esc(b.batchId)} \u2014 ${t('bagInfo.allBags')}</div>
    <div style="display:flex;flex-wrap:wrap;gap:4px;max-height:120px;overflow-y:auto">
      ${b.bags.map(bag=>{
        const isThis=bag.toUpperCase()===bagId.toUpperCase();
        const bagNum=bag.split('-').pop();
        const bagLast=[...scanLog].reverse().find(e=>(e.bag||'').toUpperCase()===bag.toUpperCase());
        const loc=!bagLast?'—':bagLast.action==='REMOVE'?'✗':bagLast.to||'?';
        return`<span style="font-size:11px;font-family:monospace;padding:3px 8px;border-radius:5px;background:${isThis?'#1a1a1a':'#f5f4f0'};color:${isThis?'#fff':'#555'};border:1px solid ${isThis?'#1a1a1a':'#e5e3dd'}" title="${loc}">
          ${bagNum} <span style="font-size:9px;color:${isThis?'#aaa':'#bbb'}">${loc}</span>
        </span>`;
      }).join('')}
    </div>
    ${bagHarvests.length?`<div style="margin-top:10px;font-size:12px;color:#92400e"><strong>${t('harvest.log')}:</strong> ${bagHarvests.map(h=>`Flush ${h.flush}: ${h.grams}g`).join(' \u00b7 ')}</div>`:''}
  `;
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
    const entry={time:new Date().toISOString(),action:'REMOVE',batch:biBatchId,bag:biBagId,from:null,to:null,user:currentUser?.username||null};scanLog.push(entry);movements.push(entry);
    scan.count++;apiPost('/api/scan-log',{entries:[entry]});updateSD();
    setFb('ok',t('scanFb.removeLogged',{bag:biBagId}));
  }else{
    setFb('ok',t('scanFb.actionReady',{action:action}));
  }
}
document.getElementById('m-baginfo').addEventListener('click',e=>{if(e.target.id==='m-baginfo')document.getElementById('m-baginfo').classList.remove('open')});

// ─── PRINT — BAG LABELS ──────────────────────────────────────
// ─── PRINT via server → ZPL → Windows spooler → GK420d ──────
// Correct size/orientation automatically — no browser dialog issues.
// Hyphens encoded as underscores in barcode to fix German keyboard scanning.

// Species abbreviation: 1 word → first 2 letters (CH), 2+ words → first letter each (BO, BK)
function spAbbrev(species){
  if(!species)return'XX';
  const words=species.trim().split(/\s+/);
  if(words.length===1)return words[0].slice(0,2).toUpperCase();
  return(words[0][0]+words[1][0]).toUpperCase();
}

function makeBagZPL(bags,batch,mode){
  return bags.map(bagId=>{
    let z='^XA^PW400^LL240^CI28^LH0,0';
    // Format: CH_ERL_0327_4 (max 13 chars)
    // species abbrev _ strain 3 chars _ MMDD _ bag number (no leading zero)
    const parts=bagId.split('-');
    let bcVal;
    if(parts.length===4){
      const sp=spAbbrev(batch.species);
      const st=(batch.strain||'000').slice(0,3).toUpperCase();
      const mmdd=parts[1].slice(2,4)+parts[1].slice(0,2); // DDMMYY '020426' → MMDD '0402'
      const bagNum=parseInt(parts[3],10);    // '04' → 4 (no leading zero)
      bcVal=sp+'_'+st+'_'+mmdd+'_'+bagNum;   // CH_ERL_0327_4
    }else{
      bcVal=bagId.replace(/-/g,'_');
    }
    z+='^FO10,5^BY2,2.0,72^BCN,72,N,N,N^FD'+bcVal+'^FS';
    z+='^FO0,84^FB400,1,0,C^A0N,38,38^FD'+bagId+'^FS';
    if(mode==='full'||mode==='date'){
      // Strain + substrate on one line
      let infoLine=batch.strain||'';
      if(batch.substrate){
        const hw=batch.substrate.hardwood||0;
        const wb=batch.substrate.wheatbran||0;
        const rh=batch.substrate.rh||0;
        const subStr=(hw?'HW'+hw+'%':'')+( wb?' WB'+wb+'%':'')+( rh?' RH'+rh+'%':'');
        if(subStr) infoLine+=(infoLine?' · ':'')+subStr;
      }
      if(infoLine) z+='^FO0,130^FB400,1,0,C^A0N,28,28^FD'+infoLine+'^FS';
    }
    if(mode==='date'){
      const due=new Date(batch.due);
      const dueStr=String(due.getDate()).padStart(2,'0')+'.'+String(due.getMonth()+1).padStart(2,'0')+'.'+due.getFullYear();
      z+='^FO0,168^FB400,1,0,C^A0N,24,24^FDFaellig: '+dueStr+'^FS';
    }
    z+='^XZ';
    return z;
  }).join('\n');
}

function makeLabZPL(ids,opts){
  return ids.map(id=>{
    const c=cultures.find(x=>x.id===id);if(!c)return'';
    const sp=(c.species||'')+(c.strain?' / '+c.strain:'');
    const ds=fmtDt(c.created);
    const bcVal=id.replace(/-/g,'_');
    let z='^XA^PW400^LL240^CI28^LH0,0';
    if(opts.bc)z+='^FO20,10^BY2,2.0,60^BCN,60,N,N,N^FD'+bcVal+'^FS';
    z+='^FO8,78^A0N,28,28^FD'+id+'^FS';
    if(opts.sp&&sp)z+='^FO8,110^A0N,20,20^FD'+sp+'^FS';
    if(opts.par&&c.parentId)z+='^FO8,135^A0N,17,17^FDParent: '+c.parentId+'^FS';
    if(opts.dt)z+='^FO8,156^A0N,16,16^FD'+ds+'^FS';
    if(opts.qr)z+='^FO272,10^BQN,2,3^FDMM,A'+id+'^FS';
    return z+'^XZ';
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
  const err=await sendToPrinter(zpl);
  if(err)alert('Print error: '+err);
  else setFb('ok','Printed '+bags.length+' labels for '+b.batchId);
}

async function printLabLabels(){
  const ids=[...selectedLabIds];
  if(!ids.length){alert('Select at least one culture.');return}
  const zpl=makeLabZPL(ids,getLabOpts());
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

function renderBagPreview(){const id=document.getElementById('print-batch').value,el=document.getElementById('bag-preview'),mode=document.getElementById('print-mode').value;if(!id){el.innerHTML='<div class="empty">Select a batch above.</div>';return}const batch=batches.find(b=>b.batchId===id);if(!batch)return;const wrap=document.createElement('div');wrap.style.cssText='display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px';batch.bags.forEach((bagId,i)=>{const cell=document.createElement('div');cell.style.cssText='border:1px solid #e5e3dd;border-radius:5px;padding:4px;text-align:center;background:#fff;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px';const parts=bagId.split('-');let bcVal;if(parts.length===4){const sp=spAbbrev(batch.species);const st=(batch.strain||'000').slice(0,3).toUpperCase();const mmdd=parts[1].slice(2,4)+parts[1].slice(0,2);const bagNum=parseInt(parts[3],10);bcVal=sp+'_'+st+'_'+mmdd+'_'+bagNum}else{bcVal=bagId.replace(/-/g,'_')}const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.style.cssText='display:block;width:100%;max-height:32px';cell.appendChild(svg);const idEl=document.createElement('div');idEl.style.cssText='font-family:monospace;font-size:8px;font-weight:600;white-space:nowrap';idEl.textContent=bagId;cell.appendChild(idEl);if(mode==='full'||mode==='date'){let infoLine=batch.strain||'';if(batch.substrate){const hw=batch.substrate.hardwood||0,wb=batch.substrate.wheatbran||0,rh=batch.substrate.rh||0;const subStr=(hw?'HW'+hw+'%':'')+(wb?' WB'+wb+'%':'')+(rh?' RH'+rh+'%':'');if(subStr)infoLine+=(infoLine?' \u00b7 ':'')+subStr}if(infoLine){const infoEl=document.createElement('div');infoEl.style.cssText='font-size:7px;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%';infoEl.textContent=infoLine;cell.appendChild(infoEl)}}if(mode==='date'&&batch.due){const due=new Date(batch.due);const dueStr=String(due.getDate()).padStart(2,'0')+'.'+String(due.getMonth()+1).padStart(2,'0')+'.'+due.getFullYear();const dueEl=document.createElement('div');dueEl.style.cssText='font-size:7px;color:#999;white-space:nowrap';dueEl.textContent='Faellig: '+dueStr;cell.appendChild(dueEl)}wrap.appendChild(cell);setTimeout(()=>{try{JsBarcode(svg,bcVal,{format:'CODE128',width:1.4,height:24,displayValue:false,margin:2,background:'#fff',lineColor:'#000'})}catch{}},50+i*10)});el.innerHTML='';el.appendChild(wrap)}

let selectedLabIds=new Set();
function renderLabList(){const filter=document.getElementById('lab-filter').value,el=document.getElementById('lab-list'),today=todayStr();const rows=cultures.filter(c=>{if(filter==='all')return c.status==='active'||c.status==='stored';if(filter==='today'){const d=new Date(c.created);return String(d.getFullYear()).slice(2)+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0')===today}return c.type===filter}).sort((a,b)=>b.created.localeCompare(a.created));el.innerHTML=rows.length?rows.map(c=>`<label style="display:flex;align-items:center;gap:7px;padding:4px 0;cursor:pointer;font-size:12px;border-bottom:0.5px solid #f0ede8"><input type="checkbox" ${selectedLabIds.has(c.id)?'checked':''} onchange="toggleLabId('${esc(c.id)}',this.checked)" style="width:14px;height:14px;margin:0" /><span style="font-family:monospace;font-weight:500">${esc(c.id)}</span><span class="badge ${c.type==='MC'?'badge-mc':c.type==='PD'?'badge-pd':'badge-lc'}">${esc(c.type)}</span><span style="color:#888">${esc(c.species)}${c.strain?' / '+esc(c.strain):''}</span></label>`).join(''):'<div style="font-size:12px;color:#aaa;padding:6px">No cultures match.</div>'}
function toggleLabId(id,on){if(on)selectedLabIds.add(id);else selectedLabIds.delete(id);renderLabPreview()}
function getLabOpts(){return{bc:document.getElementById('lp-bc').checked,qr:document.getElementById('lp-qr').checked,sp:document.getElementById('lp-sp').checked,par:document.getElementById('lp-par').checked,dt:document.getElementById('lp-dt').checked}}
function renderLabPreview(){const el=document.getElementById('lab-preview');const ids=[...selectedLabIds];if(!ids.length){el.innerHTML='<div class="empty">Tick cultures in the list to preview labels.</div>';return}const opts=getLabOpts();const wrap=document.createElement('div');wrap.style.cssText='display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px';ids.forEach((id,i)=>{const c=cultures.find(x=>x.id===id);if(!c)return;const cell=document.createElement('div');cell.style.cssText='border:1px solid #e5e3dd;border-radius:6px;padding:6px;background:#fff;aspect-ratio:2/1;overflow:hidden;display:flex;gap:4px';const left=document.createElement('div');left.style.cssText='flex:1;overflow:hidden;display:flex;flex-direction:column;justify-content:center;gap:1px';if(opts.bc){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.style.cssText='display:block;width:100%;max-height:32px';left.appendChild(svg);setTimeout(()=>{try{JsBarcode(svg,id.replace(/-/g,'_'),{format:'CODE128',width:1,height:24,displayValue:false,margin:2,background:'#fff',lineColor:'#000'})}catch{}},30+i*15)}const idEl=document.createElement('div');idEl.style.cssText='font-family:monospace;font-size:8px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';idEl.textContent=id;left.appendChild(idEl);if(opts.sp&&(c.species||c.strain)){const e2=document.createElement('div');e2.style.cssText='font-size:8px;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';e2.textContent=(c.species||'')+(c.strain?' / '+c.strain:'');left.appendChild(e2)}if(opts.par&&c.parentId){const e2=document.createElement('div');e2.style.cssText='font-size:7px;color:#888';e2.textContent='↑ '+c.parentId;left.appendChild(e2)}if(opts.dt){const e2=document.createElement('div');e2.style.cssText='font-size:7px;color:#aaa';e2.textContent=fmtDt(c.created);left.appendChild(e2)}cell.appendChild(left);if(opts.qr){const right=document.createElement('div');right.style.cssText='width:48px;flex-shrink:0;display:flex;align-items:center;justify-content:center';const qrdiv=document.createElement('div');right.appendChild(qrdiv);cell.appendChild(right);setTimeout(()=>{try{new QRCode(qrdiv,{text:id,width:44,height:44,colorDark:'#000',colorLight:'#fff',correctLevel:QRCode.CorrectLevel.L})}catch{}},40+i*15)}wrap.appendChild(cell)});el.innerHTML='';el.appendChild(wrap)}

// ─── REF BARCODES ────────────────────────────────────────────
async function makeQR(val){return new Promise(resolve=>{const div=document.createElement('div');div.style.cssText='display:inline-block';try{new QRCode(div,{text:val,width:120,height:120,colorDark:'#000',colorLight:'#fff',correctLevel:QRCode.CorrectLevel.L});setTimeout(()=>{const img=div.querySelector('img')||div.querySelector('canvas');if(img){img.style.cssText='display:block;width:100%;height:auto';resolve(img)}else resolve(null)},100)}catch{resolve(null)}})}

async function renderRefBarcodes(){const grid=document.getElementById('ref-grid');grid.innerHTML='';const useQR=document.getElementById('ref-qr').checked;for(const group of REF_GROUPS){const card=document.createElement('div');card.className='card';card.innerHTML=`<div class="sec">${group.g}</div>`;const row=document.createElement('div');row.style.cssText='display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;align-items:flex-end';for(const val of group.items){const cell=document.createElement('div');cell.className='bc-cell';cell.style.minWidth='80px';if(useQR){const img=await makeQR(val);if(img)cell.appendChild(img);const lbl=document.createElement('div');lbl.style.cssText='font-size:11px;font-weight:600;color:#555;margin-top:3px';lbl.textContent=val;cell.appendChild(lbl)}else{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.style.cssText='display:block';cell.appendChild(svg);setTimeout(()=>{try{JsBarcode(svg,val,{format:'CODE128',width:2,height:50,displayValue:true,fontSize:11,margin:12,background:'#fff',lineColor:'#000'})}catch{}},20)}row.appendChild(cell)}card.appendChild(row);grid.appendChild(card)}}
async function printRef(){const sheet=document.getElementById('ref-print-sheet');sheet.innerHTML='';const useQR=document.getElementById('ref-qr').checked;const title=document.createElement('div');title.style.cssText='font-family:Arial,sans-serif;font-size:15px;font-weight:bold;margin-bottom:12px;padding:8px';title.textContent='Meisterpilze — Reference '+(useQR?'QR Codes':'Barcodes');sheet.appendChild(title);let delay=0;for(const group of REF_GROUPS){const sec=document.createElement('div');sec.style.cssText='font-family:Arial,sans-serif;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:.08em;color:#888;margin:10px 8px 6px';sec.textContent=group.g;sheet.appendChild(sec);const row=document.createElement('div');row.style.cssText='display:flex;flex-wrap:wrap;gap:6px;padding:0 8px';for(const val of group.items){const cell=document.createElement('div');cell.style.cssText='border:1px solid #ddd;border-radius:5px;padding:5px 7px;text-align:center;background:#fff;page-break-inside:avoid';if(useQR){const img=await makeQR(val);if(img){img.style.width='80px';img.style.height='80px';cell.appendChild(img)}const lbl=document.createElement('div');lbl.style.cssText='font-size:10px;font-weight:bold;font-family:Arial,sans-serif';lbl.textContent=val;cell.appendChild(lbl)}else{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');cell.appendChild(svg);setTimeout(()=>{try{JsBarcode(svg,val,{format:'CODE128',width:2,height:50,displayValue:true,fontSize:11,margin:12,background:'#fff',lineColor:'#000'})}catch{}},delay);delay+=25}row.appendChild(cell)}sheet.appendChild(row)}setTimeout(()=>window.print(),useQR?800:delay+200)}

// ─── GLOBAL SCAN ENGINE ──────────────────────────────────────
// Session tracking
let sessionEntries=[];
let sessionStartTime=null;
let sessionErrors=0;
let _lastScanVal=null;
// Audio feedback
let _scanAudioCtx=null;
let scanAudioEnabled=true;
function _scanBeep(freq,dur){
  if(!scanAudioEnabled)return;
  try{
    if(!_scanAudioCtx)_scanAudioCtx=new(window.AudioContext||window.webkitAudioContext)();
    const o=_scanAudioCtx.createOscillator();const g=_scanAudioCtx.createGain();
    o.connect(g);g.connect(_scanAudioCtx.destination);
    o.frequency.value=freq;g.gain.value=0.15;o.start();
    g.gain.exponentialRampToValueAtTime(0.001,_scanAudioCtx.currentTime+dur/1000);
    o.stop(_scanAudioCtx.currentTime+dur/1000);
  }catch{}
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
      :'';
    el.innerHTML='<span class="sle-time">'+timeStr+'</span>'
      +'<span class="badge b-'+esc(entryData.action.toLowerCase())+'">'+esc(entryData.action)+'</span> '
      +'<span class="sle-msg"><b>'+esc(bagLabel)+'</b>'+(sp?' <span style="color:var(--c-text-muted);font-size:10px">'+esc(sp)+'</span>':'')
      +(locStr?' <span style="color:var(--c-text-muted)">'+esc(locStr)+'</span>':'')+'</span>'
      +'<button class="sle-undo" onclick="undoScanEntry(this)" title="Undo">↩</button>';
  }else{
    el.innerHTML='<span class="sle-time">'+timeStr+'</span><span class="sle-msg">'+esc(msg)+'</span>';
  }
  log.prepend(el);
  while(log.children.length>80)log.lastChild.remove();
}
let _toastTimer=null;
function setFb(type,msg,opts){
  const entryData=opts&&opts._tempId?opts:null;
  if(!opts||!opts.noModal)openScanModal();
  const el=document.getElementById('scan-toast');
  el.className='scan-toast-inline fb-'+type;
  el.textContent=msg;
  requestAnimationFrame(()=>el.classList.add('visible'));
  clearTimeout(_toastTimer);
  _toastTimer=setTimeout(()=>el.classList.remove('visible'),type==='err'?4000:3000);
  if(type==='err')sessionErrors++;
  if(type==='ok')_scanBeep(800,80);
  else if(type==='err')_scanBeep(200,200);
  _addLogEntry(type,msg,entryData);
}
function updateSD(){
  document.getElementById('s-action').textContent=scan.action||'—';
  document.getElementById('s-from').textContent=scan.from||'—';
  document.getElementById('s-to').textContent=scan.to||'—';
  document.getElementById('s-count').textContent=scan.count;
  // Action-colored header
  const modal=document.getElementById('scan-modal');
  modal.className='scan-modal'+(scan.action?' scan-action-'+scan.action.toLowerCase():'');
  // MOVE: combined from→to chip
  const fromChip=document.getElementById('chip-from');
  if(scan.action==='MOVE'&&scan.from&&scan.to){
    fromChip.style.display='none';
    document.getElementById('s-to').textContent=scan.from+' → '+scan.to;
  }else{
    fromChip.style.display='';
  }
  // Chip pulse hints
  const chipTo=document.getElementById('chip-to');
  const chipFrom=document.getElementById('chip-from');
  const toPulse=(scan.action==='ADD'&&!scan.to)||(scan.action==='MOVE'&&scan.from&&!scan.to);
  chipTo.classList.toggle('chip-pulse',toPulse);
  chipFrom.classList.toggle('chip-pulse',scan.action==='MOVE'&&!scan.from);
  // Last scan chip
  const lastChip=document.getElementById('chip-last');
  if(_lastScanVal){lastChip.style.display='';document.getElementById('s-last').textContent=_lastScanVal}
  // Count bump animation
  const countChip=document.getElementById('chip-count');
  countChip.classList.remove('count-bump');void countChip.offsetWidth;
  if(scan.count>0)countChip.classList.add('count-bump');
  // Session end button
  document.getElementById('btn-end-session').style.display=sessionEntries.length>0?'':'none';
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
    const last=sessionEntries[sessionEntries.length-1];
    const btn=document.querySelector('[data-scan-id="'+last._tempId+'"] .sle-undo');
    if(btn)undoScanEntry(btn);
  }
});
// End session → show summary
function endScanSession(){
  if(sessionEntries.length===0)return;
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
  resetScan();
}
let _scanTempIdCounter=0;
function processScan(raw){
  // Keep underscores for locations (SPAWN_R1 etc); convert to hyphens only for bag/batch IDs
  let val=raw.trim().toUpperCase();if(!val)return;
  if(ACTIONS.includes(val)||LOCS.includes(val)){/* keep underscores */}
  else{val=val.replace(/_/g,'-')} // German HID keyboard fix for bag IDs
  // Decode new format: BO-ERL-0327-6 → full bag ID BLUES-260327-01-06
  // Parts: [spAbbrev, strainPrefix, MMDD, bagNum]
  const parts=val.split('-');
  if(parts.length===4&&/^\d{4}$/.test(parts[2])&&/^\d{1,2}$/.test(parts[3])){
    const scannedSp=parts[0];   // e.g. BO
    const scannedSt=parts[1];   // e.g. ERL
    const scannedMmdd=parts[2]; // e.g. 0327
    const scannedBag=parts[3].padStart(2,'0'); // 6→06
    // Find matching batch by comparing species abbrev + strain prefix + date MMDD
    const matchBatch=batches.find(b=>{
      const bSp=spAbbrev(b.species);
      const bSt=(b.strain||'000').slice(0,3).toUpperCase();
      const bDateParts=b.batchId.split('-');
      const bMmdd=bDateParts[1]?bDateParts[1].slice(2,4)+bDateParts[1].slice(0,2):'';
      return bSp===scannedSp && bSt===scannedSt && bMmdd===scannedMmdd;
    });
    if(matchBatch){
      val=matchBatch.batchId+'-'+scannedBag;
      setFb('info',t('scanFb.matched',{val:val,batch:matchBatch.batchId}));
    }else{
      setFb('err',t('scanFb.noBatchFound',{val:val}));
      return;
    }
  }
  if(ACTIONS.includes(val)){
    scan.action=val;scan.from=null;scan.to=null;scan.harvestBag=null;
    document.getElementById('harvest-panel').style.display='none';
    _pendingDupe=null;_pendingRemove=null;
    clearTimeout(_pendingDupeTimer);clearTimeout(_pendingRemoveTimer);
    updateSD();
    setFb('ok',{ADD:t('scanFb.actionAdd'),MOVE:t('scanFb.actionMove'),REMOVE:t('scanFb.actionRemove'),HARVEST:t('scanFb.actionHarvest')}[val]);return;
  }
  if(LOCS.includes(val)){
    if(scan.action==='ADD'){scan.to=val;updateSD();setFb('ok',t('scanFb.location',{loc:val}));return}
    if(scan.action==='MOVE'&&!scan.from){scan.from=val;updateSD();setFb('ok',t('scanFb.from',{loc:val}));return}
    if(scan.action==='MOVE'&&scan.from){scan.to=val;updateSD();setFb('ok',t('scanFb.to',{loc:val}));return}
    setFb('err',t('scanFb.setAction'));return;
  }
  // Culture ID scan → open lineage
  if(/^(MC|PD|LC)-[A-Z]+-\d{6}-\d{2}$/.test(val)){
    const c=cultures.find(x=>x.id.toUpperCase()===val);
    if(c){go('lab','n-lab');openStab('lab','lineage');setTimeout(()=>{document.getElementById('lineage-sel').value='C:'+c.id;renderLineage()},100);setFb('ok',t('scanFb.cultureScanned',{val:val}));return}
  }
  const isBag=/-\d{2}$/.test(val);
  const batchId=isBag?val.split('-').slice(0,-1).join('-'):val;
  const batch=batches.find(b=>b.batchId.toUpperCase()===batchId.toUpperCase());
  if(batch||isBag){
    if(!scan.action){openBagInfo(val,batchId,batch);return}
    if(scan.action==='HARVEST'){showHarvestPanel(isBag?val:batchId,batchId);return}
    if(scan.action==='ADD'&&!scan.to){setFb('err',t('scanFb.scanLocFirst'));return}
    if(scan.action==='MOVE'&&(!scan.from||!scan.to)){setFb('err',t('scanFb.scanFromTo'));return}
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
    apiPost('/api/scan-log',{entries:[entry]}).then(r=>{if(r&&r.ids&&r.ids[0])entry._serverId=r.ids[0]});
    _lastScanVal=isBag?val:batchId;
    setFb('ok',t('scanFb.logged',{action:scan.action,val:val,to:scan.to?' \u2192 '+scan.to:'',n:scan.count}),entry);
    updateSD();return;
  }
  setFb('err',t('scanFb.unknown',{val:val}));
}
// ─── GLOBAL BARCODE BUFFER (timing-based scanner detection) ──
const _scanBuf={chars:[],timer:null};
const SCAN_MAX_GAP=50;
const SCAN_MIN_LEN=3;

function isKnownBarcode(val){
  val=val.toUpperCase();
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
    if(tbl)tbl.innerHTML='<p style="color:#888">Admin access required to manage users.</p>';
    return;
  }
  try{
    const r=await authFetch('/api/users');
    const users=await r.json();
    const tbl=document.getElementById('users-table');
    if(!tbl)return;
    tbl.innerHTML='<table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left;padding:6px;border-bottom:1px solid #ddd">Username</th><th style="text-align:left;padding:6px;border-bottom:1px solid #ddd">Role</th><th style="text-align:left;padding:6px;border-bottom:1px solid #ddd">Created</th><th style="padding:6px;border-bottom:1px solid #ddd"></th></tr></thead><tbody>'+
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
const CAL_DAYS=['Mo','Di','Mi','Do','Fr','Sa','So'];
const CAL_MONTHS=['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const CAL_HOURS_START=6,CAL_HOURS_END=22;

function fmtDate(y,m,d){return y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0')}
function parseDateStr(s){const p=s.split('-');return new Date(+p[0],+p[1]-1,+p[2])}

function collectCalendarEvents(){
  const events=[];
  batches.forEach(b=>{
    if(!b.due)return;
    const d=new Date(b.due);
    events.push({date:d.toISOString().split('T')[0],label:b.batchId+' — '+b.species+(b.strain?' ('+b.strain+')':''),type:'batch-due',id:b.batchId,draggable:true,allDay:true,color:'#ef4444'});
  });
  manualTasks.forEach(t=>{
    if(!t.dueDate)return;
    events.push({date:t.dueDate.split('T')[0],label:t.text,type:'task-due',id:t.created,draggable:!t.done,allDay:true,color:'#3b82f6'});
  });
  harvests.forEach(h=>{
    if(!h.time)return;
    const d=new Date(h.time);
    events.push({date:d.toISOString().split('T')[0],label:(h.batch||'?')+' '+h.grams+'g',type:'harvest',id:null,draggable:false,allDay:true,color:'#f59e0b'});
  });
  const filterUserId=parseInt(document.getElementById('cal-filter-user')?.value)||0;
  calendarEvents.forEach(ev=>{
    if(filterUserId&&ev.assignees&&ev.assignees.length&&!ev.assignees.some(a=>a.userId===filterUserId))return;
    events.push({date:ev.startDate,label:ev.title,type:'custom',id:ev.id,draggable:true,allDay:ev.allDay,startTime:ev.startTime,endTime:ev.endTime,color:CATEGORY_COLORS[ev.category]||ev.color||'#22c55e',description:ev.description,assignees:ev.assignees||[]});
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

// ── Month View ──
function renderCalMonth(){
  const container=document.getElementById('cal-container');
  const title=document.getElementById('cal-title');
  title.textContent=CAL_MONTHS[calMonth]+' '+calYear;
  const firstDay=new Date(calYear,calMonth,1);
  const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
  let startDow=(firstDay.getDay()+6)%7;
  const prevLast=new Date(calYear,calMonth,0).getDate();
  const events=collectCalendarEvents();
  const todayStr=new Date().toISOString().split('T')[0];
  const totalCells=startDow+daysInMonth;
  const rows=Math.max(6,Math.ceil(totalCells/7));
  const trailing=rows*7-totalCells;

  let html='<div class="cal-grid" id="cal-grid">';
  html+=CAL_DAYS.map(d=>'<div class="cal-hdr">'+d+'</div>').join('');

  function eventsForDate(ds){
    const de=events.filter(e=>e.date===ds);
    const mx=3;
    let o=de.slice(0,mx).map(e=>{
      const drag=e.draggable?'draggable="true"':'';
      const cls=e.draggable?'cal-event':'cal-event no-drag';
      const bg=e.color?'style="background:'+safeColor(e.color)+'"':'';
      const assigneeStr=e.assignees&&e.assignees.length?' <span class="cal-ev-assignees">'+e.assignees.map(a=>esc(a.username)).join(', ')+'</span>':'';
      return'<div class="'+cls+'" '+drag+' data-type="'+e.type+'" data-id="'+(e.id||'')+'" title="'+esc(e.label)+'" '+bg+' onclick="event.stopPropagation();onCalMonthEventClick(\''+e.type+'\',\''+esc(e.id||'')+'\')">'+esc(e.label)+assigneeStr+'</div>';
    }).join('');
    if(de.length>mx)o+='<div class="cal-more">+'+(de.length-mx)+' mehr</div>';
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
  const todayStr=new Date().toISOString().split('T')[0];
  title.textContent=days[0].getDate()+'. '+(days[0].getMonth()!==days[6].getMonth()?CAL_MONTHS[days[0].getMonth()]+' — '+days[6].getDate()+'. '+CAL_MONTHS[days[6].getMonth()]:' — '+days[6].getDate()+'. '+CAL_MONTHS[days[0].getMonth()])+' '+days[6].getFullYear();
  const events=collectCalendarEvents();
  const dayStrs=days.map(d=>d.toISOString().split('T')[0]);

  let html='<div class="cal-week">';
  html+='<div class="cal-week-hdr"><div class="cal-week-hdr-cell"></div>';
  days.forEach((d,i)=>{const ds=dayStrs[i];html+='<div class="cal-week-hdr-cell'+(ds===todayStr?' today-col':'')+'" onclick="calGotoDay(\''+ds+'\')">'+CAL_DAYS[i]+'<span class="wk-day-num">'+d.getDate()+'</span></div>'});
  html+='</div>';
  html+='<div class="cal-week-allday"><div class="cal-week-allday-label">Ganzt.</div>';
  days.forEach((d,i)=>{
    const ds=dayStrs[i];
    const de=events.filter(e=>e.date===ds&&e.allDay);
    html+='<div class="cal-week-allday-cell" data-date="'+ds+'">';
    de.forEach(e=>{
      const cls=e.draggable?'cal-event':'cal-event no-drag';
      const bg=e.color?'style="background:'+safeColor(e.color)+'"':'';
      html+='<div class="'+cls+'" '+(e.draggable?'draggable="true"':'')+' data-type="'+e.type+'" data-id="'+(e.id||'')+'" title="'+esc(e.label)+'" '+bg+' onclick="event.stopPropagation();onCalMonthEventClick(\''+e.type+'\',\''+esc(e.id||'')+'\')">'+esc(e.label)+'</div>';
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
        let wkContent=esc(e.label);
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
    const now=new Date();const nowDs=now.toISOString().split('T')[0];
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
  const ds=d.toISOString().split('T')[0];
  const dayName=CAL_DAYS[(d.getDay()+6)%7];
  title.textContent=dayName+', '+d.getDate()+'. '+CAL_MONTHS[d.getMonth()]+' '+d.getFullYear();
  const events=collectCalendarEvents();
  const dayEvents=events.filter(e=>e.date===ds);
  const allDay=dayEvents.filter(e=>e.allDay);
  const timed=dayEvents.filter(e=>!e.allDay&&e.startTime);

  let html='<div class="cal-day-view">';
  html+='<div class="cal-day-allday"><div class="sec">Ganztägig</div>';
  if(allDay.length){
    allDay.forEach(e=>{
      const cls=e.draggable?'cal-event':'cal-event no-drag';
      const bg=e.color?'style="background:'+safeColor(e.color)+'"':'';
      html+='<div class="'+cls+'" '+(e.draggable?'draggable="true"':'')+' data-type="'+e.type+'" data-id="'+(e.id||'')+'" title="'+esc(e.label)+'" '+bg+' onclick="event.stopPropagation();onCalMonthEventClick(\''+e.type+'\',\''+esc(e.id||'')+'\')">'+esc(e.label)+'</div>';
    });
  }else{html+='<div class="cal-day-allday-empty">Keine ganztägigen Events</div>'}
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
      let dayContent='<strong>'+esc(e.label)+'</strong>';
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
    const now=new Date();const nowDs=now.toISOString().split('T')[0];
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
    let meta=new Date(ce.startDate).toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    if(!ce.allDay&&ce.startTime)meta+=', '+ce.startTime+(ce.endTime?' — '+ce.endTime:'');
    if(ce.endDate&&ce.endDate!==ce.startDate)meta+=' bis '+new Date(ce.endDate).toLocaleDateString('de-DE',{day:'numeric',month:'long',year:'numeric'});
    metaEl.textContent=meta;
    const catLabels={custom:'Eigenes Event',meeting:'Meeting',delivery:'Lieferung',maintenance:'Wartung'};
    badgesEl.innerHTML='<span style="display:inline-block;font-size:11px;padding:2px 10px;border-radius:4px;font-weight:500;background:'+(CATEGORY_COLORS[ce.category]||safeColor(ce.color))+';color:#fff">'+esc(catLabels[ce.category]||ce.category)+'</span>';
    assignEl.innerHTML=ce.assignees&&ce.assignees.length?'Zugewiesen: <strong>'+ce.assignees.map(a=>esc(a.username)).join(', ')+'</strong>':'';
    descEl.textContent=ce.description||'';
    descEl.style.display=ce.description?'':'none';
    btnsEl.innerHTML='<button class="btn btn-r" onclick="deleteCalEventFromDetail(\''+esc(ce.id)+'\')">Löschen</button><span style="flex:1"></span><button class="btn" onclick="closeEventDetail()">Schließen</button><button class="btn btn-p" onclick="editEventFromDetail(\''+esc(ce.id)+'\')">Bearbeiten</button>';

  }else if(ev.type==='task-due'){
    const t=manualTasks.find(x=>x.created===ev.id);if(!t)return;
    titleEl.textContent=t.text;
    let meta='Aufgabe';
    if(t.dueDate)meta+=' — Fällig: '+new Date(t.dueDate).toLocaleDateString('de-DE',{day:'numeric',month:'long',year:'numeric'});
    metaEl.textContent=meta;
    const prioLabels={high:'Hoch',medium:'Mittel',low:'Niedrig'};
    const prioColors={high:'#ef4444',medium:'#f59e0b',low:'#22c55e'};
    badgesEl.innerHTML='<span style="display:inline-block;font-size:11px;padding:2px 10px;border-radius:4px;font-weight:500;background:#3b82f6;color:#fff">Aufgabe</span>'+(t.priority?'<span style="display:inline-block;font-size:11px;padding:2px 10px;border-radius:4px;font-weight:500;background:'+(prioColors[t.priority]||'#888')+';color:#fff">'+esc(prioLabels[t.priority]||t.priority)+'</span>':'');
    assignEl.innerHTML=t.assignee?'Zugewiesen: <strong>'+esc(t.assignee)+'</strong>':'Zugewiesen: <strong>Alle</strong>';
    descEl.textContent=t.description||'';
    descEl.style.display=t.description?'':'none';
    const doneLabel=t.done?'Als unerledigt markieren':'Als erledigt markieren';
    btnsEl.innerHTML='<button class="btn btn-r" onclick="deleteTaskFromCalendar(\''+esc(ev.id)+'\')">Löschen</button><button class="btn'+(t.done?'':' btn-p')+'" onclick="toggleTaskFromCalendar(\''+esc(ev.id)+'\')">'+doneLabel+'</button><span style="flex:1"></span><button class="btn" onclick="closeEventDetail()">Schließen</button><button class="btn" onclick="closeEventDetail();openEventMoveModal({type:\'task-due\',id:\''+esc(ev.id)+'\',date:\''+esc(ev.date)+'\',label:\''+esc(ev.label)+'\',draggable:true,allDay:true})">Verschieben</button><button class="btn btn-p" onclick="editTaskFromCalendar(\''+esc(ev.id)+'\')">Bearbeiten</button>';

  }else if(ev.type==='batch-due'){
    titleEl.textContent=ev.label;
    const b=batches.find(x=>x.batchId===ev.id);
    let meta='Batch-Fälligkeitstermin';
    if(b&&b.due)meta+=' — '+new Date(b.due).toLocaleDateString('de-DE',{day:'numeric',month:'long',year:'numeric'});
    metaEl.textContent=meta;
    badgesEl.innerHTML='<span style="display:inline-block;font-size:11px;padding:2px 10px;border-radius:4px;font-weight:500;background:#ef4444;color:#fff">Batch</span>';
    assignEl.innerHTML='';
    descEl.textContent=b?(b.species+(b.strain?' ('+b.strain+')':'')):'';
    descEl.style.display='';
    btnsEl.innerHTML='<span style="flex:1"></span><button class="btn" onclick="closeEventDetail()">Schließen</button><button class="btn btn-p" onclick="closeEventDetail();openEventMoveModal({type:\'batch-due\',id:\''+esc(ev.id)+'\',date:\''+esc(ev.date)+'\',label:\''+esc(ev.label)+'\',draggable:true,allDay:true})">Verschieben</button>';

  }else if(ev.type==='caldav-import'){
    titleEl.textContent=ev.label;
    let meta='CalDAV Import';
    if(ev.date)meta+=' — '+new Date(ev.date).toLocaleDateString('de-DE',{day:'numeric',month:'long',year:'numeric'});
    if(ev.startTime)meta+=', '+ev.startTime+(ev.endTime?' — '+ev.endTime:'');
    metaEl.textContent=meta;
    badgesEl.innerHTML='<span style="display:inline-block;font-size:11px;padding:2px 10px;border-radius:4px;font-weight:500;background:#6366f1;color:#fff">CalDAV</span>';
    assignEl.innerHTML='';
    descEl.textContent=ev.description||'';
    descEl.style.display=ev.description?'':'none';
    btnsEl.innerHTML='<button class="btn" onclick="closeEventDetail()">Schließen</button>';
  }
  document.getElementById('m-cal-detail').classList.add('open');
}

function closeEventDetail(){document.getElementById('m-cal-detail').classList.remove('open')}

function editEventFromDetail(id){
  closeEventDetail();
  const ce=calendarEvents.find(x=>x.id===id);
  if(ce)openEventModal(ce.startDate,ce.startTime,ce);
}

function deleteCalEventFromDetail(id){
  closeEventDetail();
  confirm2('Event löschen?','Dieses Event wird unwiderruflich gelöscht.','Löschen',()=>{
    calendarEvents=calendarEvents.filter(x=>x.id!==id);
    if(typeof saveData==='function')saveData();
    renderCalendar();
    authFetch('/api/calendar-events/'+encodeURIComponent(id),{method:'DELETE'}).catch(()=>{});
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
  confirm2('Aufgabe löschen?','Diese Aufgabe wird unwiderruflich gelöscht.','Löschen',()=>{
    const t=manualTasks.find(t=>t.created===taskId);
    if(!t)return;
    manualTasks=manualTasks.filter(x=>x.id!==t.id);
    apiDelete('/api/tasks/'+t.id);
    renderCalendar();updateTodoBadge();
  });
}

// ─── UNIFIED CALENDAR ENTRY MODAL ─────────────────────────────
const CATEGORY_COLORS={custom:'#22c55e',meeting:'#8b5cf6',delivery:'#14b8a6',maintenance:'#64748b'};
let calEntryType='task';

function setEntryType(type){
  calEntryType=type;
  document.getElementById('cal-entry-type-select').value=type;
  const isTask=type==='task';
  document.getElementById('cal-entry-enddate-wrap').style.display=isTask?'none':'';
  document.getElementById('cal-entry-allday-wrap').style.display=isTask?'none':'';
  document.getElementById('cal-entry-category-wrap').style.display=isTask?'none':'';
  document.getElementById('cal-entry-prio-wrap').style.display=isTask?'':'none';
  document.getElementById('cal-entry-task-assign-wrap').style.display=isTask?'':'none';
  document.getElementById('cal-entry-ev-assign-wrap').style.display=isTask?'none':'';
  document.getElementById('cal-entry-private-wrap').style.display=isTask?'flex':'none';
  document.getElementById('cal-entry-name').placeholder=isTask?'z.B. Luftfeuchtezelt reinigen':'z.B. Team-Meeting';
  toggleEntryTimeInputs();
}

function openEntryModal(type,date,time,existing){
  const modal=document.getElementById('m-cal-entry');
  const isEdit=!!existing;
  document.getElementById('cal-entry-name').disabled=false;
  document.getElementById('cal-entry-desc').closest('div').style.display='';
  document.getElementById('cal-entry-type-select').closest('.g2').style.display='';
  const sel=document.getElementById('cal-entry-task-assignee');
  sel.innerHTML='<option value="">Alle (Betrieb)</option>'
    +teamMembers.map(m=>'<option value="'+esc(m.name)+'">'+esc(m.name)+'</option>').join('');
  document.getElementById('cal-entry-type-select').disabled=isEdit;
  setEntryType(type||'task');
  if(type==='task'&&existing){
    document.getElementById('cal-entry-title').textContent='Eintrag bearbeiten';
    document.getElementById('cal-entry-mode').value='edit';
    document.getElementById('cal-entry-id').value=existing.id;
    document.getElementById('cal-entry-name').value=existing.text;
    document.getElementById('cal-entry-date').value=existing.dueDate?existing.dueDate.split('T')[0]:'';
    document.getElementById('cal-entry-prio').value=existing.priority||'med';
    document.getElementById('cal-entry-task-assignee').value=existing.assignee||'';
    document.getElementById('cal-entry-desc').value=existing.description||'';
    document.getElementById('cal-entry-private').checked=!!existing.private;
    document.getElementById('cal-entry-del-btn').style.display='';
  }else if(type==='event'&&existing){
    document.getElementById('cal-entry-title').textContent='Eintrag bearbeiten';
    document.getElementById('cal-entry-mode').value='edit';
    document.getElementById('cal-entry-id').value=existing.id;
    document.getElementById('cal-entry-name').value=existing.title;
    document.getElementById('cal-entry-date').value=existing.startDate;
    document.getElementById('cal-entry-end-date').value=existing.endDate||'';
    document.getElementById('cal-entry-allday').checked=existing.allDay;
    document.getElementById('cal-entry-start-time').value=existing.startTime||'09:00';
    document.getElementById('cal-entry-end-time').value=existing.endTime||'10:00';
    document.getElementById('cal-entry-category').value=existing.category||'custom';
    document.getElementById('cal-entry-desc').value=existing.description||'';
    calEvSelectedAssignees=(existing.assignees||[]).map(a=>a.userId);renderAssigneePicker();
    document.getElementById('cal-entry-del-btn').style.display='';
  }else{
    document.getElementById('cal-entry-title').textContent='Neuer Eintrag';
    document.getElementById('cal-entry-mode').value='create';
    document.getElementById('cal-entry-id').value='';
    document.getElementById('cal-entry-name').value='';
    document.getElementById('cal-entry-date').value=date||new Date().toISOString().split('T')[0];
    document.getElementById('cal-entry-end-date').value='';
    document.getElementById('cal-entry-allday').checked=!time;
    document.getElementById('cal-entry-start-time').value=time||'09:00';
    const endH=time?String(Math.min(23,parseInt(time)+1)).padStart(2,'0')+':00':'10:00';
    document.getElementById('cal-entry-end-time').value=endH;
    document.getElementById('cal-entry-category').value='custom';
    document.getElementById('cal-entry-prio').value='med';
    document.getElementById('cal-entry-task-assignee').value='';
    document.getElementById('cal-entry-desc').value='';
    document.getElementById('cal-entry-private').checked=false;
    calEvSelectedAssignees=[];renderAssigneePicker();
    document.getElementById('cal-entry-del-btn').style.display='none';
  }
  document.getElementById('cal-ev-assignee-dropdown').style.display='none';
  toggleEntryTimeInputs();
  modal.classList.add('open');
  if(!existing)setTimeout(()=>document.getElementById('cal-entry-name').focus(),50);
}

function openEventModal(date,time,existing){openEntryModal('event',date,time,existing)}
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
  if(calEntryType==='event'){
    timesEl.style.display=document.getElementById('cal-entry-allday').checked?'none':'grid';
  }else{
    timesEl.style.display='none';
  }
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
  const assignee=document.getElementById('cal-entry-task-assignee').value||null;
  const desc=document.getElementById('cal-entry-desc').value.trim()||null;
  const priv=document.getElementById('cal-entry-private').checked;
  if(mode==='edit'){
    const id=parseInt(document.getElementById('cal-entry-id').value);
    const tk=manualTasks.find(x=>x.id===id);
    if(!tk){closeEntryModal();return}
    tk.text=text;tk.priority=prio;tk.dueDate=due;tk.assignee=assignee;tk.description=desc;tk.private=priv;tk.caldavSynced=null;
    apiPatch('/api/tasks/'+id,{text:tk.text,priority:tk.priority,dueDate:tk.dueDate,assignee:tk.assignee,description:tk.description,private:priv?1:0,caldavSynced:null});
    if(caldav.enabled&&tk.caldavUid)pushTaskCaldav(tk);
  }else{
    const task={text,priority:prio,done:false,created:new Date().toISOString(),assignee,dueDate:due,description:desc,caldavUid:null,caldavSynced:null,private:priv};
    manualTasks.push(task);
    apiPost('/api/tasks',task).then(r=>{if(r&&r.id)task.id=r.id});
    if(caldav.enabled&&due)pushTaskCaldav(task);
  }
  closeEntryModal();
  renderCalendar();updateTodoBadge();
}

function saveEntryEvent(){
  const mode=document.getElementById('cal-entry-mode').value;
  const name=document.getElementById('cal-entry-name').value.trim();if(!name)return;
  const allDay=document.getElementById('cal-entry-allday').checked;
  const category=document.getElementById('cal-entry-category').value;
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
    color:CATEGORY_COLORS[category]||'#22c55e',
    caldavUid:null,caldavSynced:null,
    created:new Date().toISOString(),
    assignees:getSelectedAssigneeIds().map(uid=>{const u=appUsers.find(x=>x.id===uid);return{userId:uid,username:u?u.username:'?'}})
  };
  const assigneeIds=getSelectedAssigneeIds();
  if(mode==='edit'){
    const idx=calendarEvents.findIndex(x=>x.id===ev.id);
    if(idx>=0){ev.caldavUid=calendarEvents[idx].caldavUid;ev.created=calendarEvents[idx].created;calendarEvents[idx]=ev}
    apiPatch('/api/calendar-events/'+encodeURIComponent(ev.id),Object.assign({},ev,{assignees:assigneeIds}));
  }else{
    calendarEvents.push(ev);
    apiPost('/api/calendar-events',Object.assign({},ev,{assignees:assigneeIds})).then(r=>{if(r&&r.id)ev.id=r.id});
  }
  renderCalendar();closeEntryModal();
  if(caldav.enabled&&typeof pushEventCaldav==='function')pushEventCaldav(ev);
}

function deleteEntry(){
  if(calEntryType==='task'){
    const id=parseInt(document.getElementById('cal-entry-id').value);
    if(!id){closeEntryModal();return}
    closeEntryModal();
    confirm2('Aufgabe löschen?','Diese Aufgabe wird unwiderruflich gelöscht.','Löschen',()=>{
      manualTasks=manualTasks.filter(x=>x.id!==id);
      apiDelete('/api/tasks/'+id);
      renderCalendar();updateTodoBadge();
    });
  }else{
    const id=document.getElementById('cal-entry-id').value;if(!id)return;
    closeEntryModal();
    confirm2('Event löschen?','Dieses Event wird unwiderruflich gelöscht.','Löschen',()=>{
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
  document.getElementById('cal-entry-title').textContent='Eintrag verschieben';
  document.getElementById('cal-entry-id').value='';
  document.getElementById('cal-entry-mode').value='move';
  document.getElementById('cal-entry-name').value=ev.label;
  document.getElementById('cal-entry-name').disabled=true;
  document.getElementById('cal-entry-date').value=ev.date;
  document.getElementById('cal-entry-enddate-wrap').style.display='none';
  document.getElementById('cal-entry-allday-wrap').style.display='none';
  document.getElementById('cal-entry-times').style.display='none';
  document.getElementById('cal-entry-category-wrap').style.display='none';
  document.getElementById('cal-entry-prio-wrap').style.display='none';
  document.getElementById('cal-entry-desc').closest('div').style.display='none';
  document.getElementById('cal-entry-task-assign-wrap').style.display='none';
  document.getElementById('cal-entry-ev-assign-wrap').style.display='none';
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
function fillCalendarUserFilter(){
  const sel=document.getElementById('cal-filter-user');if(!sel)return;
  sel.innerHTML='<option value="">Alle Benutzer</option>'+appUsers.map(u=>'<option value="'+u.id+'">'+esc(u.username)+'</option>').join('');
}
function renderAssigneePicker(){
  const box=document.getElementById('cal-ev-assignees');if(!box)return;
  const dd=document.getElementById('cal-ev-assignee-dropdown');
  if(!calEvSelectedAssignees.length){box.innerHTML='<span style="color:#aaa;font-size:12px">Niemand zugewiesen</span>'}
  else{box.innerHTML=calEvSelectedAssignees.map(uid=>{const u=appUsers.find(x=>x.id===uid);return'<span class="assignee-chip">'+esc(u?u.username:'?')+' <button onclick="event.stopPropagation();toggleAssignee('+uid+')">×</button></span>'}).join('')}
  if(dd){dd.innerHTML=appUsers.map(u=>{const checked=calEvSelectedAssignees.includes(u.id);return'<label style="'+(checked?'background:#e8f5e9':'')+'" onclick="event.stopPropagation();toggleAssignee('+u.id+')"><input type="checkbox" '+(checked?'checked':'')+' style="width:auto;margin-right:6px" onclick="event.stopPropagation()">'+esc(u.username)+'</label>'}).join('')}
}
function toggleAssigneeDropdown(){
  const dd=document.getElementById('cal-ev-assignee-dropdown');if(!dd)return;
  dd.style.display=dd.style.display==='none'?'block':'none';
}
function toggleAssignee(uid){
  const i=calEvSelectedAssignees.indexOf(uid);
  if(i>=0)calEvSelectedAssignees.splice(i,1);else calEvSelectedAssignees.push(uid);
  renderAssigneePicker();
}
function getSelectedAssigneeIds(){return calEvSelectedAssignees.slice()}

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
  const modals = ['m-camscan','m-cal-entry','m-cal-detail','m-locmove','m-baginfo','m-addbags','m-batchadd','m-note','m-confirm'];
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
    badge.style.cssText='display:inline-block;background:#ef4444;color:#fff;font-size:10px;padding:2px 6px;border-radius:8px;margin-left:6px;font-weight:600';
    const syncEl=document.getElementById('sync-label');
    if(syncEl)syncEl.parentNode.appendChild(badge);
    else document.querySelector('.topbar')?.appendChild(badge);
  }
  badge.textContent=count+' queued';
}

// ─── EVENT LISTENERS (CSP-safe, no inline handlers) ─────────────
function openCamScan(){document.getElementById('m-camscan').classList.add('open')}
function closeCamScan(){document.getElementById('m-camscan').classList.remove('open')}
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
  $('btn-10').addEventListener('click', locRemoveSelected);
  $('cls-11').addEventListener('click', () => { document.getElementById('m-baginfo').classList.remove('open'); });
  $('set-12').addEventListener('click', () => { biSetAction('ADD'); });
  $('set-13').addEventListener('click', () => { biSetAction('MOVE'); });
  $('set-14').addEventListener('click', () => { biSetAction('HARVEST'); });
  $('set-15').addEventListener('click', () => { biSetAction('REMOVE'); });
  $('m-camscan').addEventListener('click', function(e) { if(e.target===this) closeCamScan(); });
  $('cls-16').addEventListener('click', closeCamScan);

  // Sidebar navigation
  $('sb-toggle').addEventListener('click', toggleSidebar);
  $('n-dash').addEventListener('click', () => { go('dash','n-dash'); });
  $('n-cal').addEventListener('click', () => { go('cal','n-cal'); });
  $('n-batch').addEventListener('click', () => { go('batch','n-batch'); });
  $('n-lab').addEventListener('click', () => { go('lab','n-lab'); });
  $('n-inv').addEventListener('click', () => { go('inv','n-inv'); });
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
  $('btn-scan-audio').addEventListener('click', function() { scanAudioEnabled=!scanAudioEnabled;this.style.opacity=scanAudioEnabled?1:.4; });

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
    }
  });
  $('st-batch-list').addEventListener('click', () => { openStab('batch','list'); });
  $('st-batch-new').addEventListener('click', () => { openStab('batch','new'); });
  $('st-batch-harvest').addEventListener('click', () => { openStab('batch','harvest'); });
  $('batch-q').addEventListener('input', renderBatches);
  $('nb-type').addEventListener('change', nbTypeChange);
  $('wbtn-3').addEventListener('click', () => { setBagWeight(3); });
  $('wbtn-5').addEventListener('click', () => { setBagWeight(5); });
  $('wbtn-07').addEventListener('click', () => { setBagWeight(0.7); });
  $('wbtn-1').addEventListener('click', () => { setBagWeight(1); });
  $('wbtn-2').addEventListener('click', () => { setBagWeight(2); });
  $('wbtn-5g').addEventListener('click', () => { setBagWeight(5); });
  $('nb-weight').addEventListener('input', nbPreview);
  $('nb-sp').addEventListener('input', nbPreview);
  $('nb-st').addEventListener('input', nbPreview);
  $('nb-qty').addEventListener('input', nbPreview);
  $('nb-hw').addEventListener('input', nbSubSum);
  $('nb-wb').addEventListener('input', nbSubSum);
  $('nb-rh').addEventListener('input', nbPreview);
  $('btn-24').addEventListener('click', createBatch);
  $('prt-25').addEventListener('click', goToPrintBatch);
  $('harvest-q').addEventListener('input', renderHarvests);

  // Lab
  $('st-lab-cultures').addEventListener('click', () => { openStab('lab','cultures'); });
  $('st-lab-work').addEventListener('click', () => { openStab('lab','work'); });
  $('st-lab-lineage').addEventListener('click', () => { openStab('lab','lineage'); });
  $('cult-type').addEventListener('change', renderCultures);
  $('cult-stat').addEventListener('change', renderCultures);
  $('lw-type').addEventListener('change', lwUpdate);
  $('lw-sp').addEventListener('input', lwPreview);
  $('lw-qty').addEventListener('input', lwPreview);
  $('btn-26').addEventListener('click', logLabWork);
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
  $('btn-cal-add').addEventListener('click', ()=>openEntryModal());
  $('cal-entry-cancel-btn').addEventListener('click', closeEntryModal);
  $('cal-entry-save-btn').addEventListener('click', saveEntry);
  $('cal-entry-del-btn').addEventListener('click', deleteEntry);
  $('cal-entry-allday').addEventListener('change', toggleEntryTimeInputs);
  $('m-cal-entry').addEventListener('click', e=>{if(e.target.id==='m-cal-entry')closeEntryModal()});
  $('cal-ev-assignees').addEventListener('click', toggleAssigneeDropdown);

  // Settings
  $('st-settings-log').addEventListener('click', () => { openStab('settings','log'); });
  $('st-settings-backup').addEventListener('click', () => { openStab('settings','backup'); });
  $('st-settings-users').addEventListener('click', () => { openStab('settings','users');loadUsersTab(); });
  $('st-settings-caldav').addEventListener('click', () => { openStab('settings','caldav'); });
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

  // Camera FAB (element is after the script tag, may not exist yet)
  if($('cam-fab')) $('cam-fab').addEventListener('click', openCamScan);
}

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

const canvas = document.getElementById('threeCanvas');
const viewport = document.getElementById('viewportWrap');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe7ebef);

const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 1000);
camera.position.set(18, 18, 18);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;
controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
controls.update();

scene.add(new THREE.HemisphereLight(0xffffff, 0x718096, 1.8));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(12, 25, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

const GRID_SIZE = 60;
const GRID_STEP = 0.5;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE), new THREE.MeshStandardMaterial({ color: 0xf8f9fa, roughness: 1 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
floor.userData.ignorePick = true;
scene.add(floor);
const grid = new THREE.GridHelper(GRID_SIZE, GRID_SIZE / GRID_STEP, 0x8f9aa6, 0xc7cdd3);
grid.position.y = 0.003;
grid.userData.ignorePick = true;
scene.add(grid);
const axes = new THREE.AxesHelper(2);
axes.position.y = 0.02;
axes.userData.ignorePick = true;
scene.add(axes);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const stlLoader = new STLLoader();

const STATUS_COLORS = {
  'Работает': null,
  'Отключён': '#7b8794',
  'Простой': '#d5a928',
  'Обслуживание': '#e67e22',
  'Ремонт': '#c95d20',
  'Авария': '#d93636',
};

let equipmentTypes = [];
let objects = [];
let selected = null;
let activeTool = 'select';
let dragging = false;
let dragOffset = new THREE.Vector3();
let wallStart = null;
let objectCounter = 1;

const uid = (prefix = 'obj') => `${prefix}-${Date.now()}-${objectCounter++}`;
const snap = value => Math.round(value / GRID_STEP) * GRID_STEP;
const setStatus = text => { document.getElementById('statusText').textContent = text; };
const escapeHtml = value => String(value).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[c]));
const escapeAttr = escapeHtml;
const kindTitle = kind => ({ equipment: 'Оборудование', wall: 'Стена', door: 'Дверь' })[kind] || kind;

function pointerNdc(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

function pointerOnFloor(event) {
  pointerNdc(event);
  const p = new THREE.Vector3();
  return raycaster.ray.intersectPlane(groundPlane, p) ? p : null;
}

function rootFromHit(object) {
  let current = object;
  while (current && !current.userData.sceneObject && current.parent) current = current.parent;
  return current?.userData?.sceneObject ? current : null;
}

function pickObject(event) {
  pointerNdc(event);
  for (const hit of raycaster.intersectObjects(objects, true)) {
    const root = rootFromHit(hit.object);
    if (root) return root;
  }
  return null;
}

function makeLabelSprite(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(20,27,35,.88)';
  ctx.roundRect(4, 4, 504, 88, 16); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 32px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 48);
  const texture = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(3.6, .68, 1); sprite.userData.label = true;
  return sprite;
}

function refreshLabel(obj) {
  const old = obj.children.find(c => c.userData.label);
  if (old) { old.material.map?.dispose(); old.material.dispose(); obj.remove(old); }
  if (!obj.userData.name) return;
  const sprite = makeLabelSprite(obj.userData.name);
  sprite.position.set(0, (obj.userData.height || 1) + .55, 0);
  obj.add(sprite);
}

function makePlaceholder(root) {
  const d = root.userData;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(d.width, d.height, d.depth),
    new THREE.MeshStandardMaterial({ color: d.baseColor, roughness: .72, metalness: .08, transparent: !!d.modelUrl, opacity: d.modelUrl ? .25 : 1 })
  );
  body.position.y = d.height / 2;
  body.castShadow = true; body.receiveShadow = true;
  body.userData.body = true; body.userData.placeholder = true;
  root.add(body);
  if (!d.modelUrl) {
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(d.width * .72, Math.max(.14, d.height * .08), d.depth * .72),
      new THREE.MeshStandardMaterial({ color: 0x293541, roughness: .55 })
    );
    top.position.y = d.height + Math.max(.07, d.height * .04);
    top.castShadow = true; top.userData.body = true;
    root.add(top);
  }
}

function fitStlMesh(mesh, root) {
  const geometry = mesh.geometry;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return;
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  geometry.translate(-center.x, -box.min.y, -center.z);
  mesh.scale.set(
    root.userData.width / Math.max(size.x, 1e-9),
    root.userData.height / Math.max(size.y, 1e-9),
    root.userData.depth / Math.max(size.z, 1e-9)
  );
}

function loadStlIntoEquipment(root) {
  if (!root.userData.modelUrl) return;
  root.userData.modelLoading = true;
  setStatus(`Загрузка STL: ${root.userData.name}`);
  stlLoader.load(root.userData.modelUrl, geometry => {
    if (!root.parent) { geometry.dispose(); return; }
    root.children.filter(c => c.userData.placeholder).forEach(c => { c.geometry.dispose(); c.material.dispose(); root.remove(c); });
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: root.userData.baseColor, roughness: .62, metalness: .18 }));
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.body = true; mesh.userData.stl = true;
    root.add(mesh);
    fitStlMesh(mesh, root);
    root.userData.modelLoading = false;
    applyStatusAppearance(root);
    refreshLabel(root);
    setStatus(`STL загружен: ${root.userData.name}`);
  }, undefined, err => {
    console.error(err);
    root.userData.modelLoading = false;
    setStatus(`Ошибка STL: ${root.userData.name}`);
  });
}

function applyStatusAppearance(root) {
  if (root.userData.kind !== 'equipment') return;
  const status = root.userData.params?.состояние || 'Работает';
  const color = STATUS_COLORS[status] || root.userData.baseColor;
  root.traverse(child => {
    if (child.isMesh && child.userData.body && child.material?.color) child.material.color.set(color || root.userData.baseColor);
  });
}

function addEquipment(type, position = new THREE.Vector3(), data = null) {
  const root = new THREE.Group();
  root.position.set(snap(position.x), 0, snap(position.z));
  root.rotation.y = data?.rotationY ?? 0;
  root.userData = {
    sceneObject: true, kind: 'equipment', uuid: data?.uuid ?? uid('eq'),
    typeId: data?.typeId ?? type.id, name: data?.name ?? type.name,
    width: data?.width ?? type.width, depth: data?.depth ?? type.depth, height: data?.height ?? type.height,
    baseColor: data?.baseColor ?? data?.color ?? type.color, color: data?.color ?? type.color,
    params: structuredClone(data?.params ?? type.default_params ?? {}),
    modelUrl: data?.modelUrl ?? type.model_url ?? null,
    modelFilename: data?.modelFilename ?? type.model_filename ?? null,
    modelUnit: data?.modelUnit ?? type.model_unit ?? 'mm',
  };
  if (!root.userData.params.состояние) root.userData.params.состояние = 'Работает';
  makePlaceholder(root); refreshLabel(root); scene.add(root); objects.push(root);
  applyStatusAppearance(root); selectObject(root); refreshSceneTree(); loadStlIntoEquipment(root);
  return root;
}

function addWall(start, end, data = null) {
  const sx = data?.start?.x ?? snap(start.x), sz = data?.start?.z ?? snap(start.z);
  const ex = data?.end?.x ?? snap(end.x), ez = data?.end?.z ?? snap(end.z);
  const dx = ex - sx, dz = ez - sz, length = Math.hypot(dx, dz);
  if (length < GRID_STEP) return null;
  const height = data?.height ?? 3, thickness = data?.thickness ?? .18;
  const root = new THREE.Group();
  root.position.set((sx + ex) / 2, 0, (sz + ez) / 2); root.rotation.y = -Math.atan2(dz, dx);
  root.userData = { sceneObject: true, kind: 'wall', uuid: data?.uuid ?? uid('wall'), name: data?.name ?? 'Стена', start: {x:sx,z:sz}, end:{x:ex,z:ez}, height, thickness };
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, height, thickness), new THREE.MeshStandardMaterial({ color: 0xc7ccd1, roughness: .92 }));
  mesh.position.y = height / 2; mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh);
  scene.add(root); objects.push(root); selectObject(root); refreshSceneTree(); return root;
}

function addDoor(position, data = null) {
  const width = data?.width ?? 1.2, height = data?.height ?? 2.1, depth = data?.depth ?? .12;
  const root = new THREE.Group(); root.position.set(snap(position.x), 0, snap(position.z)); root.rotation.y = data?.rotationY ?? 0;
  root.userData = { sceneObject:true, kind:'door', uuid:data?.uuid ?? uid('door'), name:data?.name ?? 'Дверь', width,height,depth };
  const panel = new THREE.Mesh(new THREE.BoxGeometry(width,height,depth), new THREE.MeshStandardMaterial({color:0xc6905d,transparent:true,opacity:.86}));
  panel.position.y = height/2; panel.castShadow=true; root.add(panel); root.add(new THREE.BoxHelper(panel,0x4c372a));
  scene.add(root); objects.push(root); selectObject(root); refreshSceneTree(); return root;
}

function setHighlight(obj, enabled) {
  obj.traverse(child => {
    if (child.isMesh && child.material?.emissive) {
      child.material.emissive.set(enabled ? 0x1c4e80 : 0x000000);
      child.material.emissiveIntensity = enabled ? .23 : 0;
    }
  });
}

function selectObject(obj) {
  if (selected === obj) return;
  if (selected) setHighlight(selected, false);
  selected = obj;
  if (selected) setHighlight(selected, true);
  renderProperties(); refreshSceneTree();
  const badge = document.getElementById('selectionBadge');
  if (selected) { badge.textContent = selected.userData.name || selected.userData.kind; badge.classList.remove('d-none'); }
  else badge.classList.add('d-none');
}

function disposeObject(obj) {
  obj.traverse(child => { child.geometry?.dispose?.(); if (child.material) { child.material.map?.dispose?.(); child.material.dispose?.(); } });
}
function removeSelected() {
  if (!selected) return;
  const victim = selected; selected = null; scene.remove(victim); objects = objects.filter(o => o !== victim); disposeObject(victim); renderProperties(); refreshSceneTree();
}

function rebuildEquipmentGeometry(obj) {
  const stl = obj.children.find(c => c.userData.stl);
  if (stl) fitStlMesh(stl, obj);
  const placeholder = obj.children.find(c => c.userData.placeholder);
  if (placeholder) {
    placeholder.geometry.dispose(); placeholder.geometry = new THREE.BoxGeometry(obj.userData.width,obj.userData.height,obj.userData.depth); placeholder.position.y=obj.userData.height/2;
  }
  refreshLabel(obj);
}

function paramsHtml(params) {
  return Object.entries(params || {}).filter(([k]) => k !== 'состояние').map(([k,v]) => `<div class="param-row"><input class="form-control form-control-sm param-key" value="${escapeAttr(k)}"><input class="form-control form-control-sm param-value" value="${escapeAttr(String(v ?? ''))}"></div>`).join('');
}

function renderProperties() {
  const panel = document.getElementById('propertiesPanel');
  if (!selected) { panel.innerHTML = '<span class="text-secondary">Выберите объект на сцене.</span>'; return; }
  const d = selected.userData;
  let html = `<div class="mb-2"><div class="property-label">Тип</div><strong>${escapeHtml(kindTitle(d.kind))}</strong></div>
    <div class="mb-2"><label class="property-label">Название</label><input id="propName" class="form-control form-control-sm" value="${escapeAttr(d.name || '')}"></div>
    <div class="row g-1"><div class="col-6"><label class="property-label">X, м</label><input id="propX" type="number" step="0.5" class="form-control form-control-sm" value="${selected.position.x.toFixed(2)}"></div><div class="col-6"><label class="property-label">Z, м</label><input id="propZ" type="number" step="0.5" class="form-control form-control-sm" value="${selected.position.z.toFixed(2)}"></div></div>
    <div class="mt-1"><label class="property-label">Поворот, °</label><input id="propRotation" type="number" step="5" class="form-control form-control-sm" value="${THREE.MathUtils.radToDeg(selected.rotation.y).toFixed(0)}"></div>`;
  if (d.kind === 'equipment') {
    const options = Object.keys(STATUS_COLORS).map(s => `<option ${s === (d.params?.состояние || 'Работает') ? 'selected' : ''}>${s}</option>`).join('');
    html += `<div class="property-section"><label class="property-label">Состояние</label><select id="propStatus" class="form-select form-select-sm">${options}</select></div>
      ${d.modelUrl ? `<div class="property-section"><div class="small"><strong>STL:</strong> ${escapeHtml(d.modelFilename || '3D-модель')}<br><span class="text-secondary">Исходные единицы: ${escapeHtml(d.modelUnit)}</span></div></div>` : ''}
      <div class="property-section"><div class="row g-1"><div class="col"><label class="property-label">X</label><input id="propWidth" type="number" step=".001" min=".001" class="form-control form-control-sm" value="${d.width}"></div><div class="col"><label class="property-label">Z</label><input id="propDepth" type="number" step=".001" min=".001" class="form-control form-control-sm" value="${d.depth}"></div><div class="col"><label class="property-label">Y</label><input id="propHeight" type="number" step=".001" min=".001" class="form-control form-control-sm" value="${d.height}"></div></div></div>
      <div class="property-section"><strong>Паспорт и параметры</strong><div id="paramsEditor" class="mt-2">${paramsHtml(d.params)}</div><button id="addParamBtn" class="btn btn-sm btn-outline-secondary w-100 mt-1">+ параметр</button></div>`;
  }
  panel.innerHTML = html; bindPropertyEvents();
}

function collectParams() {
  if (!selected || selected.userData.kind !== 'equipment') return;
  const state = selected.userData.params?.состояние || 'Работает';
  const params = { состояние: state };
  document.querySelectorAll('.param-row').forEach(row => {
    const key = row.querySelector('.param-key').value.trim(), value = row.querySelector('.param-value').value;
    if (key && key !== 'состояние') params[key] = value;
  });
  selected.userData.params = params;
}

function bindPropertyEvents() {
  if (!selected) return;
  const byId = id => document.getElementById(id);
  byId('propName')?.addEventListener('input', e => { selected.userData.name=e.target.value; refreshLabel(selected); refreshSceneTree(); });
  const applyTransform = () => { selected.position.x=snap(parseFloat(byId('propX').value)||0); selected.position.z=snap(parseFloat(byId('propZ').value)||0); selected.rotation.y=THREE.MathUtils.degToRad(parseFloat(byId('propRotation').value)||0); };
  ['propX','propZ','propRotation'].forEach(id => byId(id)?.addEventListener('change',applyTransform));
  if (selected.userData.kind === 'equipment') {
    byId('propStatus')?.addEventListener('change', e => { collectParams(); selected.userData.params.состояние=e.target.value; applyStatusAppearance(selected); refreshSceneTree(); });
    const rebuild = () => { selected.userData.width=Math.max(.001,parseFloat(byId('propWidth').value)||1); selected.userData.depth=Math.max(.001,parseFloat(byId('propDepth').value)||1); selected.userData.height=Math.max(.001,parseFloat(byId('propHeight').value)||1); rebuildEquipmentGeometry(selected); };
    ['propWidth','propDepth','propHeight'].forEach(id => byId(id)?.addEventListener('change',rebuild));
    document.querySelectorAll('.param-key,.param-value').forEach(el => el.addEventListener('change',collectParams));
    byId('addParamBtn')?.addEventListener('click',()=>{ collectParams(); selected.userData.params[`параметр_${Object.keys(selected.userData.params).length}`]=''; renderProperties(); });
  }
}

function refreshSceneTree() {
  const el = document.getElementById('sceneTree');
  if (!objects.length) { el.innerHTML='<div class="small text-secondary">План пока пуст.</div>'; return; }
  el.innerHTML = objects.map(o => {
    const status = o.userData.kind === 'equipment' ? ` · ${escapeHtml(o.userData.params?.состояние || 'Работает')}` : '';
    return `<div class="scene-item ${o===selected?'active':''}" data-uuid="${o.userData.uuid}"><div><strong>${escapeHtml(o.userData.name||kindTitle(o.userData.kind))}</strong><div class="equipment-meta">${kindTitle(o.userData.kind)}${status}</div></div></div>`;
  }).join('');
  el.querySelectorAll('.scene-item').forEach(item=>item.addEventListener('click',()=>selectObject(objects.find(o=>o.userData.uuid===item.dataset.uuid)||null)));
}

function renderEquipmentTree(filter='') {
  const target=document.getElementById('equipmentTree'), normalized=filter.trim().toLowerCase();
  const filtered=equipmentTypes.filter(x=>!normalized||`${x.name} ${x.category} ${JSON.stringify(x.default_params)}`.toLowerCase().includes(normalized));
  const groups={}; filtered.forEach(x=>(groups[x.category||'Прочее'] ||= []).push(x));
  target.innerHTML=Object.entries(groups).map(([category,items])=>`<div class="equipment-category"><div class="equipment-category-title">${escapeHtml(category)}</div>${items.map(item=>`<div class="equipment-item" draggable="true" data-type-id="${item.id}"><span class="equipment-swatch" style="background:${item.color}"></span><div><strong>${escapeHtml(item.name)}</strong>${item.model_url?'<span class="badge text-bg-dark ms-1">STL</span>':''}<div class="equipment-meta">${item.width}×${item.depth}×${item.height} м</div></div></div>`).join('')}</div>`).join('')||'<div class="small text-secondary">Ничего не найдено.</div>';
  target.querySelectorAll('.equipment-item').forEach(item=>{
    item.addEventListener('click',()=>{ const type=equipmentTypes.find(t=>t.id===Number(item.dataset.typeId)); addEquipment(type,controls.target.clone()); });
    item.addEventListener('dragstart',e=>e.dataTransfer.setData('text/equipment-type',item.dataset.typeId));
  });
}

function setTool(tool) {
  activeTool=tool; wallStart=null;
  document.querySelectorAll('.tool-btn').forEach(btn=>{ const active=btn.dataset.tool===tool; btn.classList.toggle('active',active); btn.classList.toggle('btn-outline-primary',active); btn.classList.toggle('btn-outline-secondary',!active); });
  setStatus(tool==='wall'?'Стена: укажите первую точку':tool==='door'?'Дверь: укажите точку':'Режим выбора');
}

renderer.domElement.addEventListener('pointerdown',event=>{
  if(event.button!==0)return;
  if(activeTool==='wall'){const p=pointerOnFloor(event);if(!p)return;if(!wallStart){wallStart=p.clone();setStatus('Стена: укажите вторую точку');}else{addWall(wallStart,p);wallStart=p.clone();setStatus('Стена добавлена. Следующая точка продолжит стену');}return;}
  if(activeTool==='door'){const p=pointerOnFloor(event);if(p)addDoor(p);setTool('select');return;}
  if(activeTool!=='select')return;
  const hit=pickObject(event);selectObject(hit);if(hit){const p=pointerOnFloor(event);if(p){dragging=true;dragOffset.copy(hit.position).sub(p);controls.enabled=false;renderer.domElement.setPointerCapture?.(event.pointerId);}}
});
renderer.domElement.addEventListener('pointermove',event=>{if(!dragging||!selected||activeTool!=='select')return;const p=pointerOnFloor(event);if(!p)return;selected.position.x=snap(p.x+dragOffset.x);selected.position.z=snap(p.z+dragOffset.z);const px=document.getElementById('propX'),pz=document.getElementById('propZ');if(px)px.value=selected.position.x.toFixed(2);if(pz)pz.value=selected.position.z.toFixed(2);});
window.addEventListener('pointerup',()=>{dragging=false;controls.enabled=true;});
viewport.addEventListener('dragover',e=>e.preventDefault());
viewport.addEventListener('drop',e=>{e.preventDefault();const type=equipmentTypes.find(t=>t.id===Number(e.dataTransfer.getData('text/equipment-type'))),p=pointerOnFloor(e);if(type&&p)addEquipment(type,p);});

function serializeScene(){collectParams();return{version:2,gridStep:GRID_STEP,camera:{position:camera.position.toArray(),target:controls.target.toArray()},objects:objects.map(o=>{const d=o.userData;if(d.kind==='equipment')return{kind:d.kind,uuid:d.uuid,typeId:d.typeId,name:d.name,position:{x:o.position.x,z:o.position.z},rotationY:o.rotation.y,width:d.width,depth:d.depth,height:d.height,color:d.color,baseColor:d.baseColor,params:d.params,modelUrl:d.modelUrl,modelFilename:d.modelFilename,modelUnit:d.modelUnit};if(d.kind==='wall')return{kind:d.kind,uuid:d.uuid,name:d.name,start:d.start,end:d.end,height:d.height,thickness:d.thickness};return{kind:d.kind,uuid:d.uuid,name:d.name,position:{x:o.position.x,z:o.position.z},rotationY:o.rotation.y,width:d.width,height:d.height,depth:d.depth};})};}
function clearSceneObjects(){selectObject(null);[...objects].forEach(o=>{scene.remove(o);disposeObject(o);});objects=[];refreshSceneTree();}
function loadScene(data){clearSceneObjects();for(const item of data?.objects||[]){if(item.kind==='equipment'){const type=equipmentTypes.find(t=>t.id===item.typeId)||{id:item.typeId,name:item.name,width:item.width,depth:item.depth,height:item.height,color:item.color||'#4472c4',default_params:item.params||{},model_url:item.modelUrl,model_filename:item.modelFilename,model_unit:item.modelUnit};addEquipment(type,new THREE.Vector3(item.position?.x||0,0,item.position?.z||0),item);}else if(item.kind==='wall')addWall(new THREE.Vector3(item.start.x,0,item.start.z),new THREE.Vector3(item.end.x,0,item.end.z),item);else if(item.kind==='door')addDoor(new THREE.Vector3(item.position?.x||0,0,item.position?.z||0),item);}if(data?.camera?.position)camera.position.fromArray(data.camera.position);if(data?.camera?.target)controls.target.fromArray(data.camera.target);controls.update();selectObject(null);}

async function saveLayout(){const name=document.getElementById('layoutName').value.trim()||'Основной цех';setStatus('Сохранение...');const res=await fetch('/api/layouts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,data:serializeScene()})});if(!res.ok)throw new Error('Не удалось сохранить планировку');setStatus('Сохранено');await refreshLayouts();}
async function refreshLayouts(){const list=await fetch('/api/layouts').then(r=>r.json()),el=document.getElementById('layoutsList');el.innerHTML=list.length?list.map(layout=>`<div class="list-group-item d-flex align-items-center gap-2"><div class="flex-grow-1"><strong>${escapeHtml(layout.name)}</strong><div class="small text-secondary">${layout.updated_at?new Date(layout.updated_at).toLocaleString():''}</div></div><button class="btn btn-sm btn-primary load-layout" data-id="${layout.id}">Открыть</button><button class="btn btn-sm btn-outline-danger delete-layout" data-id="${layout.id}">Удалить</button></div>`).join(''):'<div class="text-secondary">Сохранённых планировок пока нет.</div>';el.querySelectorAll('.load-layout').forEach(btn=>btn.addEventListener('click',async()=>{const layout=await fetch(`/api/layouts/${btn.dataset.id}`).then(r=>r.json());document.getElementById('layoutName').value=layout.name;loadScene(layout.data);bootstrap.Modal.getOrCreateInstance(document.getElementById('layoutsModal')).hide();setStatus(`Открыта планировка «${layout.name}»`);}));el.querySelectorAll('.delete-layout').forEach(btn=>btn.addEventListener('click',async()=>{await fetch(`/api/layouts/${btn.dataset.id}`,{method:'DELETE'});refreshLayouts();}));}

function resize(){const width=viewport.clientWidth,height=viewport.clientHeight;renderer.setSize(width,height,false);camera.aspect=width/Math.max(height,1);camera.updateProjectionMatrix();}
new ResizeObserver(resize).observe(viewport);resize();
(function animate(){requestAnimationFrame(animate);controls.update();renderer.render(scene,camera);})();

document.querySelectorAll('.tool-btn').forEach(btn=>btn.addEventListener('click',()=>setTool(btn.dataset.tool)));
document.getElementById('deleteBtn').addEventListener('click',removeSelected);
document.getElementById('equipmentSearch').addEventListener('input',e=>renderEquipmentTree(e.target.value));
document.getElementById('saveBtn').addEventListener('click',()=>saveLayout().catch(err=>setStatus(err.message)));
document.getElementById('loadBtn').addEventListener('click',refreshLayouts);
document.getElementById('topViewBtn').addEventListener('click',()=>{camera.position.set(0,38,.01);controls.target.set(0,0,0);controls.update();});
document.getElementById('isoViewBtn').addEventListener('click',()=>{camera.position.set(18,18,18);controls.target.set(0,0,0);controls.update();});

document.getElementById('equipmentForm').addEventListener('submit',async e=>{
  e.preventDefault(); const fd=new FormData(e.target), stl=fd.get('stl'); let res;
  setStatus(stl&&stl.size?'Загрузка STL...':'Добавление оборудования...');
  if(stl&&stl.size){res=await fetch('/api/equipment-types/import-stl',{method:'POST',body:fd});}
  else{const payload={name:fd.get('name'),category:fd.get('category'),width:Number(fd.get('width')),depth:Number(fd.get('depth')),height:Number(fd.get('height')),color:fd.get('color'),model_unit:fd.get('model_unit'),default_params:{}};res=await fetch('/api/equipment-types',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});}
  const created=await res.json(); if(!res.ok){setStatus(created.error||'Ошибка добавления');return;}
  equipmentTypes.push(created); renderEquipmentTree(); e.target.reset(); e.target.querySelector('[name=category]').value='Металлообработка / Токарные'; e.target.querySelector('[name=color]').value='#4472c4';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('equipmentModal')).hide(); setStatus(created.model_url?'STL импортирован в базу':'Оборудование добавлено');
});

window.addEventListener('keydown',e=>{if((e.key==='Delete'||e.key==='Backspace')&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))removeSelected();if(e.key==='Escape'){wallStart=null;setTool('select');}if(e.key.toLowerCase()==='r'&&selected){selected.rotation.y+=Math.PI/2;renderProperties();}});

(async function init(){equipmentTypes=await fetch('/api/equipment-types').then(r=>r.json());renderEquipmentTree();refreshSceneTree();refreshLayouts();})();

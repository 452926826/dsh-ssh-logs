window.__ModuleLoader__.load({
  id: 'dsh-ssh-logs',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')
    const API = '/api/plugins/ssh-logs/servers'
    const css = `
      .ssh-panel{display:flex;flex-direction:column;gap:16px;max-width:960px;color:var(--dsw-alias-label-primary)}
      .ssh-head,.ssh-actions{display:flex;align-items:center;justify-content:space-between;gap:8px}.ssh-head h3{font-size:16px;margin:0}
      .ssh-table{width:100%;border-collapse:collapse;font-size:13px}.ssh-table th,.ssh-table td{padding:9px 8px;border-bottom:1px solid var(--dsw-alias-border-l2);text-align:left}
      .ssh-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.ssh-field{display:flex;flex-direction:column;gap:5px;font-size:13px}.ssh-wide{grid-column:1/-1}
      .ssh-field input,.ssh-field textarea{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);padding:8px;border-radius:6px;font:inherit}.ssh-field textarea{min-height:72px;resize:vertical}
      .ssh-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);padding:7px 12px;border-radius:6px;cursor:pointer}.ssh-danger{color:var(--dsw-alias-state-error-primary)}
      .ssh-warning{padding:10px;border-left:3px solid #d97706;background:rgba(217,119,6,.1);font-size:13px}.ssh-muted{color:var(--dsw-alias-label-tertiary);font-size:13px}
      @media(max-width:700px){.ssh-form{grid-template-columns:1fr}.ssh-wide{grid-column:auto}.ssh-table{display:block;overflow:auto}}
    `
    if (!document.querySelector('style[data-plugin-css=dsh-ssh-logs]')) { const s=document.createElement('style');s.dataset.pluginCss='dsh-ssh-logs';s.textContent=css;document.head.appendChild(s) }
    const empty = () => ({ name:'',host:'',port:22,user:'',password:'',permission:'read-only',acknowledgeWriteRisk:false,allowedCommands:'tail\ngrep\nls',deniedCommands:'rm\nrmdir\nsh\nbash\nzsh\nsudo' })
    const splitCommands = value => value.split(/\n|,/).map(x=>x.trim()).filter(Boolean)
    async function request(path='', options={}) { const r=await fetch(API+path,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});const v=await r.json();if(!r.ok)throw new Error(v.error||`HTTP ${r.status}`);return v }
    function Settings() {
      const [servers,setServers]=React.useState([]),[form,setForm]=React.useState(empty()),[editing,setEditing]=React.useState(null),[error,setError]=React.useState('')
      const load=()=>request().then(v=>setServers(v.servers)).catch(e=>setError(String(e)))
      React.useEffect(()=>{load()},[])
      const change=(key,value)=>setForm(v=>({...v,[key]:value}))
      const payload=()=>({...form,port:Number(form.port),allowedCommands:splitCommands(form.allowedCommands),deniedCommands:splitCommands(form.deniedCommands),originalName:editing})
      const testConnection=async()=>{try{setError('正在测试连接…');const result=await request('/test-connection',{method:'POST',body:JSON.stringify(payload())});setError(result.message||'SSH连接成功')}catch(e){setError(`连接测试失败：${String(e)}`)}}
      const edit=s=>{setEditing(s.name);setForm({...s,password:'',allowedCommands:(s.allowedCommands||[]).join('\n'),deniedCommands:(s.deniedCommands||[]).join('\n')})}
      const save=async()=>{try{await request(editing?`/${encodeURIComponent(editing)}`:'',{method:editing?'PUT':'POST',body:JSON.stringify(payload())});setForm(empty());setEditing(null);setError('');await load()}catch(e){setError(String(e))}}
      const remove=async name=>{if(!confirm(`删除 SSH 配置 ${name}？`))return;try{await request(`/${encodeURIComponent(name)}`,{method:'DELETE'});await load()}catch(e){setError(String(e))}}
      const field=(label,key,type='text',wide=false)=>React.createElement('label',{className:`ssh-field${wide?' ssh-wide':''}`},label,React.createElement('input',{type,value:form[key],onChange:e=>change(key,e.target.value)}))
      const commandList=(label,key)=>React.createElement('label',{className:'ssh-field ssh-wide'},label,React.createElement('textarea',{value:form[key],onChange:e=>change(key,e.target.value)}))
      return React.createElement('div',{className:'ssh-panel'},React.createElement('div',{className:'ssh-head'},React.createElement('h3',null,'SSH 服务器'),React.createElement('button',{className:'ssh-btn',onClick:()=>{setEditing(null);setForm(empty())}},'新增')),
        React.createElement('div',{className:'ssh-muted'},'配置仅存于当前 DSH 主机。远程命令默认拒绝；禁止命令优先于允许命令。'),
        React.createElement('table',{className:'ssh-table'},React.createElement('thead',null,React.createElement('tr',null,...['名称','地址','账号','允许命令','操作'].map(x=>React.createElement('th',{key:x},x)))),React.createElement('tbody',null,...servers.map(s=>React.createElement('tr',{key:s.name},React.createElement('td',null,s.name),React.createElement('td',null,`${s.host}:${s.port}`),React.createElement('td',null,s.user),React.createElement('td',null,(s.allowedCommands||[]).join(', ')),React.createElement('td',null,React.createElement('button',{className:'ssh-btn',onClick:()=>edit(s)},'编辑'),' ',React.createElement('button',{className:'ssh-btn ssh-danger',onClick:()=>remove(s.name)},'删除')))))),
        React.createElement('div',{className:'ssh-form'},field('SSH 名称','name'),field('IP / 主机名','host'),field('端口','port','number'),field('账号','user'),field(editing?'密码（留空保留原密码）':'密码','password','password'),commandList('允许命令（每行一个命令名）','allowedCommands'),commandList('禁止命令（每行一个命令名，优先级更高）','deniedCommands')),
        React.createElement('label',{className:'ssh-field ssh-wide'},React.createElement('span',null,'允许执行远程运维命令'),React.createElement('input',{type:'checkbox',checked:form.permission==='read-write',onChange:e=>setForm(v=>({...v,permission:e.target.checked?'read-write':'read-only',acknowledgeWriteRisk:e.target.checked}))})),
        React.createElement('div',{className:'ssh-warning'},'启用远程命令可修改服务器数据，命令白名单不是只读沙箱。请独立核验 SSH 主机密钥。'),
        error?React.createElement('div',{className:'ssh-danger'},error):null,React.createElement('div',{className:'ssh-actions'},React.createElement('button',{className:'ssh-btn',onClick:testConnection},'测试连接'),React.createElement('button',{className:'ssh-btn',onClick:save},editing?'保存修改':'添加服务器')))
    }
    const inject=['locale','slots','inputTriggers']
    function apply(ctx){const list=()=>request().then(v=>v.servers).catch(()=>[]);ctx.effect(()=>ctx.inputTriggers.registerSource({trigger:'@',name:'ssh-server',order:3,async candidates(_session,{query,signal}){const rows=await list();if(signal.aborted)return[];return rows.filter(s=>s.name.toLowerCase().startsWith(query.toLowerCase())).map(s=>({name:s.name,description:`${s.user}@${s.host}:${s.port} · ${s.allowedCommands?.join(', ')||'无允许命令'}`}))},onPick({candidate}){return{text:`@${candidate.name} `}}}), 'ssh-logs: @ server source');ctx.effect(()=>ctx.locale.register('settings.sshLogs',{zh:{tab:'SSH 服务器'},en:{tab:'SSH servers'}}));ctx.slots.inject('settings.plugins.tab',()=>ctx.slots.register({name:'settings.plugins.tab',id:'ssh-logs',order:45,label:()=> 'SSH 服务器',locale:'settings.sshLogs'},Settings))}
    module.exports={inject,apply};return module.exports
  }
})

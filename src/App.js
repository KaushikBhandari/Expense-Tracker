// ─────────────────────────────────────────────────────────────────────────────
// TravelExpenseTracker.jsx — Firebase connected version
// Firestore (real-time) + Firebase Auth + Firebase Storage (receipts)
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from "react";

// Firebase imports
import { db, auth, storage } from "./firebase";
import {
  collection, addDoc, updateDoc, deleteDoc,
  doc, onSnapshot, serverTimestamp, query, orderBy
} from "firebase/firestore";
import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged
} from "firebase/auth";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

// ── Color tokens ──────────────────────────────────────────────────────────────
const O  = "#F26522"; const OL = "#FFF3EC"; const OM = "#FEE0CC"; const OD = "#C44E10";
const TX = "#1A1A2E"; const T2 = "#6B7280"; const T3 = "#9CA3AF";
const BG = "#F8F5F2"; const WH = "#FFFFFF"; const BD = "#E8E3DE";
const GR = "#10B981"; const GRL = "#ECFDF5"; const GRB = "#A7F3D0";
const RD = "#EF4444"; const RDL = "#FEF2F2"; const RDB = "#FECACA";
const YL = "#F59E0B"; const YLL = "#FFFBEB"; const YLB = "#FDE68A";
const BL = "#3B82F6"; const BLL = "#EFF6FF";
const PU = "#8B5CF6";

const CATEGORIES = [
  { id:"flights",    label:"Flights",    icon:"✈",  color:BL, bg:BLL        },
  { id:"hotels",     label:"Hotels",     icon:"🏨", color:PU, bg:"#F5F3FF"  },
  { id:"meals",      label:"Meals",      icon:"🍽", color:GR, bg:GRL        },
  { id:"transport",  label:"Transport",  icon:"🚕", color:O,  bg:OL         },
  { id:"activities", label:"Activities", icon:"🎟", color:"#EC4899", bg:"#FDF2F8" },
  { id:"misc",       label:"Misc",       icon:"📎", color:T2, bg:"#F9FAFB"  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt    = n  => "₹" + Math.abs(Number(n)).toLocaleString("en-IN");
const fmtSgn = n  => (n < 0 ? "−₹" : "₹") + Math.abs(Math.round(n)).toLocaleString("en-IN");
const pct    = (a,b) => b === 0 ? 0 : Math.min(999, Math.round((a/b)*100));
const catOf  = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[5];

const tripPL = (trip, expenses) => {
  const spent      = expenses.filter(e => e.tripId === trip.id && e.status !== "rejected").reduce((s,e) => s + e.amount, 0);
  const revenue    = trip.invoiceAmount  || 0;
  const commission = Math.round(revenue * (trip.commissionPct || 0) / 100);
  const profit     = revenue - spent;
  const margin     = revenue > 0 ? Math.round((profit / revenue) * 100) : 0;
  return { spent, revenue, commission, profit, margin };
};

// ── UI helpers ────────────────────────────────────────────────────────────────
function StatusBadge({ s }) {
  const map = {
    approved:  { bg:GRL, color:"#059669", border:GRB,       label:"Approved"  },
    pending:   { bg:YLL, color:"#D97706", border:YLB,       label:"Pending"   },
    rejected:  { bg:RDL, color:"#DC2626", border:RDB,       label:"Rejected"  },
    active:    { bg:OL,  color:OD,        border:OM,        label:"Active"    },
    completed: { bg:"#F3F4F6", color:T2,  border:"#E5E7EB", label:"Completed" },
    paid:      { bg:GRL, color:"#059669", border:GRB,       label:"Paid"      },
    partial:   { bg:YLL, color:"#D97706", border:YLB,       label:"Partial"   },
    unpaid:    { bg:RDL, color:"#DC2626", border:RDB,       label:"Unpaid"    },
  };
  const m = map[s] || map.pending;
  return <span style={{ background:m.bg, color:m.color, border:`1px solid ${m.border}`, fontSize:11, fontWeight:700, padding:"3px 9px", borderRadius:20, letterSpacing:"0.04em", textTransform:"uppercase", whiteSpace:"nowrap" }}>{m.label}</span>;
}

function PLBadge({ value }) {
  const pos = value >= 0;
  return <span style={{ background:pos?GRL:RDL, color:pos?"#059669":"#DC2626", border:`1px solid ${pos?GRB:RDB}`, fontSize:12, fontWeight:800, padding:"4px 12px", borderRadius:20, whiteSpace:"nowrap" }}>{pos?"▲ ":"▼ "}{fmtSgn(value)}</span>;
}

function AnimNum({ value }) {
  const [d,setD] = useState(0);
  useEffect(() => {
    let s=0;
    const step = ts => { if(!s) s=ts; const p=Math.min((ts-s)/900,1); setD(Math.round((1-Math.pow(1-p,3))*Math.abs(value))); if(p<1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }, [value]);
  return <>{value<0?"−₹":"₹"}{d.toLocaleString("en-IN")}</>;
}

function Donut({ used, total, color=O }) {
  const p=pct(used,total), r=28, cx=34, cy=34, circ=2*Math.PI*r;
  return (
    <svg width={68} height={68} style={{ transform:"rotate(-90deg)", flexShrink:0 }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={BD} strokeWidth={7}/>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={7}
        strokeDasharray={`${Math.min(p,100)/100*circ} ${circ}`} strokeLinecap="round"
        style={{ transition:"stroke-dasharray 1s ease" }}/>
    </svg>
  );
}

function SparkBar({ values, color }) {
  const max = Math.max(...values,1);
  return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:3, height:24 }}>
      {values.map((v,i) => <div key={i} style={{ flex:1, background:color, borderRadius:2, opacity:0.25+0.75*(v/max), height:`${Math.max(3,(v/max)*24)}px` }}/>)}
    </div>
  );
}

function HBar({ value, max, color, height=8 }) {
  const w = max>0 ? Math.min(100,(value/max)*100) : 0;
  return (
    <div style={{ height, background:BG, borderRadius:4, border:`1px solid ${BD}`, overflow:"hidden" }}>
      <div style={{ height:"100%", background:color, borderRadius:4, width:`${w}%`, transition:"width 1.2s ease" }}/>
    </div>
  );
}

// ── Loading spinner ────────────────────────────────────────────────────────────
function Spinner({ size=24, color=O }) {
  return (
    <div style={{ width:size, height:size, border:`3px solid ${color}33`, borderTop:`3px solid ${color}`, borderRadius:"50%", animation:"spin 0.7s linear infinite", display:"inline-block" }}/>
  );
}

// ── Modal wrapper ─────────────────────────────────────────────────────────────
function Modal({ onClose, title, subtitle, children, width=520 }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(26,26,46,0.45)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(4px)" }}>
      <div style={{ background:WH, borderRadius:20, padding:36, width, maxWidth:"95vw", maxHeight:"90vh", overflowY:"auto", boxShadow:"0 24px 80px rgba(0,0,0,0.15)", border:`1px solid ${BD}` }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:28 }}>
          <div>
            <div style={{ fontSize:22, fontWeight:800, color:TX }}>{title}</div>
            {subtitle && <div style={{ color:T2, fontSize:13, marginTop:3 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} style={{ background:BG, border:`1px solid ${BD}`, color:T2, width:34, height:34, borderRadius:"50%", cursor:"pointer", fontSize:18, display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// LOGIN SCREEN
// ════════════════════════════════════════════════════════════════════════════════
function LoginScreen({ onLogin }) {
  const [mode,    setMode]   = useState("login"); // "login" | "register"
  const [email,   setEmail]  = useState("");
  const [pass,    setPass]   = useState("");
  const [name,    setName]   = useState("");
  const [loading, setLoading]= useState(false);
  const [error,   setError]  = useState("");

  const iStyle = { width:"100%", border:`1.5px solid ${BD}`, borderRadius:10, padding:"12px 14px", color:TX, fontSize:14, outline:"none", background:BG, boxSizing:"border-box", fontFamily:"inherit", marginBottom:14 };

  const handleSubmit = async () => {
    setError(""); setLoading(true);
    try {
      if (mode === "login") {
        await signInWithEmailAndPassword(auth, email, pass);
      } else {
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        // Save user profile to Firestore
        await addDoc(collection(db, "users"), {
          uid: cred.user.uid, name, email, role:"staff", createdAt: serverTimestamp()
        });
      }
    } catch (e) {
      setError(e.message.replace("Firebase: ", "").replace(/\(auth.*\)\.?/, ""));
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight:"100vh", background:BG, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Plus Jakarta Sans', sans-serif" }}>
      <div style={{ background:WH, borderRadius:24, padding:48, width:420, maxWidth:"95vw", boxShadow:"0 24px 80px rgba(0,0,0,0.1)", border:`1px solid ${BD}` }}>
        {/* Logo */}
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:32 }}>
          <div style={{ width:44, height:44, borderRadius:12, background:O, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, color:WH }}>✈</div>
          <div>
            <div style={{ fontSize:20, fontWeight:800, color:TX, letterSpacing:"-0.02em" }}>ExpensePro</div>
            <div style={{ fontSize:11, color:T3, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase" }}>Travel Agency</div>
          </div>
        </div>

        <div style={{ fontSize:22, fontWeight:800, color:TX, marginBottom:6 }}>{mode==="login" ? "Welcome back" : "Create account"}</div>
        <div style={{ color:T2, fontSize:13, marginBottom:28 }}>{mode==="login" ? "Sign in to your agency account" : "Register a new staff account"}</div>

        {mode==="register" && (
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Full name" style={iStyle}/>
        )}
        <input type="email"    value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email address" style={iStyle}/>
        <input type="password" value={pass}  onChange={e=>setPass(e.target.value)}  placeholder="Password" style={{ ...iStyle, marginBottom:8 }}
          onKeyDown={e=>e.key==="Enter"&&handleSubmit()}/>

        {error && <div style={{ background:RDL, border:`1px solid ${RDB}`, borderRadius:10, padding:"10px 14px", color:"#DC2626", fontSize:13, marginBottom:14 }}>{error}</div>}

        <button onClick={handleSubmit} disabled={loading}
          style={{ width:"100%", background:O, border:"none", borderRadius:12, padding:"14px 0", color:WH, fontSize:15, fontWeight:700, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", gap:10, marginBottom:16 }}>
          {loading ? <Spinner size={18} color={WH}/> : (mode==="login" ? "Sign In" : "Create Account")}
        </button>

        <div style={{ textAlign:"center", fontSize:13, color:T2 }}>
          {mode==="login" ? "Don't have an account? " : "Already have an account? "}
          <span onClick={()=>{setMode(mode==="login"?"register":"login");setError("");}} style={{ color:O, fontWeight:700, cursor:"pointer" }}>
            {mode==="login" ? "Register" : "Sign In"}
          </span>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// ADD EXPENSE MODAL — with Firebase Storage receipt upload
// ════════════════════════════════════════════════════════════════════════════════
function AddExpenseModal({ onClose, trips, currentUser, notify }) {
  const [form, setForm]       = useState({ tripId:trips[0]?.id||"", category:"flights", amount:"", description:"", date:new Date().toISOString().slice(0,10) });
  const [file, setFile]       = useState(null);
  const [uploading, setUpl]   = useState(false);
  const fileRef               = useRef();

  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const submit = async () => {
    if (!form.amount || !form.description || !form.tripId) return;
    setUpl(true);
    try {
      let receiptURL = null;
      // Upload receipt to Firebase Storage if file selected
      if (file) {
        const storageRef = ref(storage, `receipts/${Date.now()}_${file.name}`);
        await uploadBytes(storageRef, file);
        receiptURL = await getDownloadURL(storageRef);
      }
      // Save expense to Firestore
      await addDoc(collection(db, "expenses"), {
        tripId:      form.tripId,
        category:    form.category,
        amount:      Number(form.amount),
        description: form.description,
        date:        form.date,
        status:      "pending",
        submittedBy: currentUser?.email || "Unknown",
        receipt:     !!receiptURL,
        receiptURL:  receiptURL || null,
        createdAt:   serverTimestamp(),
      });
      notify("Expense submitted to Firebase ✓");
      onClose();
    } catch(e) {
      notify("Error: " + e.message);
    }
    setUpl(false);
  };

  const iStyle = { width:"100%", border:`1.5px solid ${BD}`, borderRadius:10, padding:"10px 14px", color:TX, fontSize:14, outline:"none", background:BG, boxSizing:"border-box", fontFamily:"inherit" };
  const lbl    = { color:T3, fontSize:11, fontWeight:700, letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:6, display:"block" };

  return (
    <Modal onClose={onClose} title="Log Expense" subtitle="Saves directly to Firebase">
      {[
        { label:"Trip",        type:"select", key:"tripId",      opts:trips.map(t=>[t.id,t.name]) },
        { label:"Category",    type:"select", key:"category",    opts:CATEGORIES.map(c=>[c.id,`${c.icon} ${c.label}`]) },
        { label:"Amount (₹)",  type:"number", key:"amount",      ph:"e.g. 45000" },
        { label:"Description", type:"text",   key:"description", ph:"Describe the expense…" },
        { label:"Date",        type:"date",   key:"date" },
      ].map(({label,type,key,opts,ph}) => (
        <div key={key} style={{ marginBottom:16 }}>
          <label style={lbl}>{label}</label>
          {type==="select"
            ? <select value={form[key]} onChange={e=>set(key,e.target.value)} style={{...iStyle,appearance:"none"}}>{opts.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
            : <input type={type} value={form[key]} onChange={e=>set(key,e.target.value)} placeholder={ph} style={iStyle}/>}
        </div>
      ))}

      {/* Receipt upload */}
      <div style={{ marginBottom:24 }}>
        <label style={lbl}>Receipt (optional)</label>
        <div onClick={()=>fileRef.current.click()} style={{ border:`2px dashed ${file?O:BD}`, borderRadius:10, padding:"14px 18px", cursor:"pointer", background:file?OL:BG, display:"flex", alignItems:"center", gap:12, transition:"all 0.2s" }}>
          <span style={{ fontSize:22 }}>📎</span>
          <div>
            <div style={{ fontSize:13, fontWeight:600, color:file?OD:T2 }}>{file ? file.name : "Click to upload receipt"}</div>
            <div style={{ fontSize:11, color:T3 }}>PNG, JPG, PDF — max 5MB</div>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*,.pdf" style={{ display:"none" }} onChange={e=>setFile(e.target.files[0]||null)}/>
      </div>

      <button onClick={submit} disabled={uploading}
        style={{ width:"100%", background:O, border:"none", borderRadius:12, padding:"13px 0", color:WH, fontSize:15, fontWeight:700, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}>
        {uploading ? <><Spinner size={18} color={WH}/> Uploading…</> : "Submit to Firebase"}
      </button>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// ADD TRIP MODAL
// ════════════════════════════════════════════════════════════════════════════════
function AddTripModal({ onClose, notify }) {
  const [form, setForm] = useState({ name:"", client:"", destination:"", staff:"", budget:"", invoiceAmount:"", commissionPct:10, paymentStatus:"unpaid", paymentReceived:0, status:"active", startDate:"", endDate:"" });
  const [saving, setSaving] = useState(false);
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const submit = async () => {
    if (!form.name || !form.client || !form.budget) return;
    setSaving(true);
    try {
      await addDoc(collection(db,"trips"), {
        ...form,
        budget:          Number(form.budget),
        invoiceAmount:   Number(form.invoiceAmount)||0,
        commissionPct:   Number(form.commissionPct)||0,
        paymentReceived: Number(form.paymentReceived)||0,
        createdAt:       serverTimestamp(),
      });
      notify("Trip created in Firebase ✓");
      onClose();
    } catch(e) { notify("Error: "+e.message); }
    setSaving(false);
  };

  const iStyle = { width:"100%", border:`1.5px solid ${BD}`, borderRadius:10, padding:"10px 14px", color:TX, fontSize:14, outline:"none", background:BG, boxSizing:"border-box", fontFamily:"inherit" };
  const lbl    = { color:T3, fontSize:11, fontWeight:700, letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:6, display:"block" };

  return (
    <Modal onClose={onClose} title="New Trip" subtitle="Creates a trip in Firestore" width={560}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 16px" }}>
        {[
          { label:"Trip Name",      key:"name",          type:"text",   ph:"e.g. Bali Honeymoon Package",  full:true  },
          { label:"Client Name",    key:"client",        type:"text",   ph:"e.g. Sharma Family"            },
          { label:"Destination",    key:"destination",   type:"text",   ph:"e.g. Bali, Indonesia"          },
          { label:"Assigned Staff", key:"staff",         type:"text",   ph:"e.g. Rahul Gupta"              },
          { label:"Start Date",     key:"startDate",     type:"date"                                        },
          { label:"End Date",       key:"endDate",       type:"date"                                        },
          { label:"Budget (₹)",     key:"budget",        type:"number", ph:"Internal cost budget"          },
          { label:"Invoice (₹)",    key:"invoiceAmount", type:"number", ph:"What you charge the client"    },
          { label:"Commission %",   key:"commissionPct", type:"number", ph:"e.g. 10"                       },
          { label:"Received (₹)",   key:"paymentReceived",type:"number",ph:"Amount client paid so far"    },
        ].map(({label,key,type,ph,full})=>(
          <div key={key} style={{ marginBottom:14, gridColumn:full?"1 / -1":"auto" }}>
            <label style={lbl}>{label}</label>
            <input type={type} value={form[key]} onChange={e=>set(key,e.target.value)} placeholder={ph} style={iStyle}/>
          </div>
        ))}
      </div>

      <div style={{ marginBottom:20 }}>
        <label style={lbl}>Payment Status</label>
        <div style={{ display:"flex", gap:10 }}>
          {[["paid","✓ Paid",GRL,"#059669",GRB],["partial","◑ Partial",YLL,"#D97706",YLB],["unpaid","✕ Unpaid",RDL,"#DC2626",RDB]].map(([val,label,bg,col,bdr])=>(
            <div key={val} onClick={()=>set("paymentStatus",val)}
              style={{ flex:1, textAlign:"center", padding:"10px 0", borderRadius:10, background:form.paymentStatus===val?bg:BG, border:`1.5px solid ${form.paymentStatus===val?bdr:BD}`, color:form.paymentStatus===val?col:T2, fontWeight:700, fontSize:13, cursor:"pointer", transition:"all 0.15s" }}>
              {label}
            </div>
          ))}
        </div>
      </div>

      <button onClick={submit} disabled={saving}
        style={{ width:"100%", background:O, border:"none", borderRadius:12, padding:"13px 0", color:WH, fontSize:15, fontWeight:700, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}>
        {saving ? <><Spinner size={18} color={WH}/> Saving…</> : "Create Trip in Firebase"}
      </button>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// EDIT REVENUE MODAL
// ════════════════════════════════════════════════════════════════════════════════
function EditRevenueModal({ trip, onClose, notify }) {
  const [form, setForm] = useState({ invoiceAmount:trip.invoiceAmount||0, paymentReceived:trip.paymentReceived||0, paymentStatus:trip.paymentStatus||"unpaid", commissionPct:trip.commissionPct||0 });
  const [saving, setSaving] = useState(false);
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const submit = async () => {
    setSaving(true);
    try {
      await updateDoc(doc(db,"trips",trip.id), { ...form, invoiceAmount:Number(form.invoiceAmount), paymentReceived:Number(form.paymentReceived), commissionPct:Number(form.commissionPct) });
      notify("Revenue updated in Firebase ✓");
      onClose();
    } catch(e) { notify("Error: "+e.message); }
    setSaving(false);
  };

  const iStyle = { width:"100%", border:`1.5px solid ${BD}`, borderRadius:10, padding:"10px 14px", color:TX, fontSize:14, outline:"none", background:BG, boxSizing:"border-box", fontFamily:"inherit" };
  const lbl    = { color:T3, fontSize:11, fontWeight:700, letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:6, display:"block" };

  return (
    <Modal onClose={onClose} title="Edit Revenue & Payment" subtitle={trip.name}>
      {[
        { label:"Invoice Amount (₹) — charged to client", key:"invoiceAmount",   type:"number" },
        { label:"Amount Received (₹) — paid so far",      key:"paymentReceived", type:"number" },
        { label:"Commission % — your agency margin",       key:"commissionPct",   type:"number" },
      ].map(({label,key,type})=>(
        <div key={key} style={{ marginBottom:16 }}>
          <label style={lbl}>{label}</label>
          <input type={type} value={form[key]} onChange={e=>set(key,e.target.value)} style={iStyle}/>
        </div>
      ))}

      <div style={{ marginBottom:20 }}>
        <label style={lbl}>Payment Status</label>
        <div style={{ display:"flex", gap:10 }}>
          {[["paid","✓ Paid",GRL,"#059669",GRB],["partial","◑ Partial",YLL,"#D97706",YLB],["unpaid","✕ Unpaid",RDL,"#DC2626",RDB]].map(([val,label,bg,col,bdr])=>(
            <div key={val} onClick={()=>set("paymentStatus",val)}
              style={{ flex:1, textAlign:"center", padding:"10px 0", borderRadius:10, background:form.paymentStatus===val?bg:BG, border:`1.5px solid ${form.paymentStatus===val?bdr:BD}`, color:form.paymentStatus===val?col:T2, fontWeight:700, fontSize:13, cursor:"pointer" }}>
              {label}
            </div>
          ))}
        </div>
      </div>

      {/* Live preview */}
      <div style={{ background:BG, borderRadius:12, padding:16, border:`1px solid ${BD}`, marginBottom:24 }}>
        <div style={{ fontSize:10, fontWeight:700, color:T3, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:10 }}>Preview</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          {[
            ["Invoice",     fmt(form.invoiceAmount),                                          O ],
            ["Received",    fmt(form.paymentReceived),                                        GR],
            ["Commission",  fmt(Math.round(form.invoiceAmount*(form.commissionPct/100))),     BL],
            ["Outstanding", fmt(Math.max(0,form.invoiceAmount-form.paymentReceived)), form.invoiceAmount>form.paymentReceived?RD:GR],
          ].map(([l,v,c])=>(
            <div key={l} style={{ background:WH, borderRadius:8, padding:"10px 12px", border:`1px solid ${BD}` }}>
              <div style={{ fontSize:10, color:T3, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>{l}</div>
              <div style={{ fontSize:16, fontWeight:800, color:c, marginTop:3 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      <button onClick={submit} disabled={saving}
        style={{ width:"100%", background:O, border:"none", borderRadius:12, padding:"13px 0", color:WH, fontSize:15, fontWeight:700, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}>
        {saving ? <><Spinner size={18} color={WH}/> Saving…</> : "Save to Firebase"}
      </button>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// EXPENSE TABLE
// ════════════════════════════════════════════════════════════════════════════════
function ExpenseTable({ rows, trips, onApprove, onReject }) {
  const th = { textAlign:"left", padding:"10px 14px", color:T3, fontSize:11, fontWeight:700, letterSpacing:"0.07em", textTransform:"uppercase", borderBottom:`1.5px solid ${BD}`, whiteSpace:"nowrap", background:BG };
  return (
    <div style={{ overflowX:"auto" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
        <thead><tr>{["Category","Description","Trip","Amount","Date","Status","Receipt",""].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((e,i)=>{
            const trip=trips.find(t=>t.id===e.tripId); const cat=catOf(e.category);
            return (
              <tr key={e.id} style={{ borderBottom:`1px solid ${BD}`, background:i%2===0?WH:BG, transition:"background 0.15s" }}
                onMouseEnter={ev=>ev.currentTarget.style.background=OL}
                onMouseLeave={ev=>ev.currentTarget.style.background=i%2===0?WH:BG}>
                <td style={{ padding:"13px 14px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ width:30, height:30, borderRadius:8, background:cat.bg, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, flexShrink:0 }}>{cat.icon}</div>
                    <span style={{ color:T2, fontSize:12 }}>{cat.label}</span>
                  </div>
                </td>
                <td style={{ padding:"13px 14px", color:TX, maxWidth:200 }}>
                  <div style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", fontWeight:600 }}>{e.description}</div>
                  <div style={{ fontSize:11, color:T3 }}>{e.submittedBy}</div>
                </td>
                <td style={{ padding:"13px 14px", color:T2, whiteSpace:"nowrap", fontSize:12 }}>{trip?.name?.slice(0,20)}…</td>
                <td style={{ padding:"13px 14px", color:TX, fontWeight:800, whiteSpace:"nowrap" }}>{fmt(e.amount)}</td>
                <td style={{ padding:"13px 14px", color:T3, whiteSpace:"nowrap" }}>{e.date}</td>
                <td style={{ padding:"13px 14px" }}><StatusBadge s={e.status}/></td>
                <td style={{ padding:"13px 14px" }}>
                  {e.receiptURL
                    ? <a href={e.receiptURL} target="_blank" rel="noreferrer" style={{ color:BL, fontSize:12, fontWeight:600, textDecoration:"none" }}>📎 View</a>
                    : <span style={{ color:T3, fontSize:12 }}>—</span>}
                </td>
                <td style={{ padding:"13px 14px" }}>
                  {e.status==="pending"&&(
                    <div style={{ display:"flex", gap:6 }}>
                      <button onClick={()=>onApprove(e.id)} style={{ background:GR, border:"none", color:WH, borderRadius:7, padding:"5px 12px", fontSize:11, cursor:"pointer", fontWeight:700, fontFamily:"inherit" }}>✓</button>
                      <button onClick={()=>onReject(e.id)}  style={{ background:WH, border:`1.5px solid ${BD}`, color:T2, borderRadius:7, padding:"5px 10px", fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>✕</button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length===0&&<div style={{ textAlign:"center", padding:"48px 0", color:T3 }}><div style={{ fontSize:32, marginBottom:8 }}>🔍</div><div>No expenses found</div></div>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ════════════════════════════════════════════════════════════════════════════════
export default function TravelExpenseTracker() {
  // ── Auth state ──────────────────────────────────────────────────────────────
  const [currentUser, setCurrentUser] = useState(undefined); // undefined = loading

  // ── Firestore live data ─────────────────────────────────────────────────────
  const [trips,    setTrips]    = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [dbLoading, setDbLoading] = useState(true);

  // ── UI state ────────────────────────────────────────────────────────────────
  const [tab,          setTab]         = useState("dashboard");
  const [showAdd,      setShowAdd]     = useState(false);
  const [showAddTrip,  setShowAddTrip] = useState(false);
  const [editRevTrip,  setEditRevTrip] = useState(null);
  const [tripDetail,   setTD]          = useState(null);
  const [filterTrip,   setFT]          = useState("all");
  const [filterStatus, setFS]          = useState("all");
  const [filterCat,    setFC]          = useState("all");
  const [search,       setSR]          = useState("");
  const [toast,        setToast]       = useState(null);

  const notify = msg => { setToast(msg); setTimeout(()=>setToast(null),3500); };

  // ── Listen to Firebase Auth ─────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, user => setCurrentUser(user || null));
    return unsub;
  }, []);

  // ── Listen to Firestore in real time ────────────────────────────────────────
  useEffect(() => {
    if (!currentUser) return;
    setDbLoading(true);

    const unsubTrips = onSnapshot(
      query(collection(db,"trips"), orderBy("createdAt","desc")),
      snap => {
        setTrips(snap.docs.map(d=>({id:d.id,...d.data()})));
        setDbLoading(false);
      },
      err => { console.error(err); setDbLoading(false); }
    );

    const unsubExp = onSnapshot(
      query(collection(db,"expenses"), orderBy("createdAt","desc")),
      snap => setExpenses(snap.docs.map(d=>({id:d.id,...d.data()}))),
      err => console.error(err)
    );

    return () => { unsubTrips(); unsubExp(); };
  }, [currentUser]);

  // ── Firestore write helpers ─────────────────────────────────────────────────
  const approveExp = async id => {
    await updateDoc(doc(db,"expenses",id),{ status:"approved" });
    notify("Expense approved ✓");
  };
  const rejectExp = async id => {
    await updateDoc(doc(db,"expenses",id),{ status:"rejected" });
    notify("Expense rejected");
  };

  // ── Derived numbers ─────────────────────────────────────────────────────────
  const pending      = expenses.filter(e=>e.status==="pending");
  const plData       = trips.map(t=>({...t,...tripPL(t,expenses)}));
  const totalRevenue = plData.reduce((s,t)=>s+t.revenue,0);
  const totalSpend   = plData.reduce((s,t)=>s+t.spent,0);
  const totalProfit  = plData.reduce((s,t)=>s+t.profit,0);
  const totalReceived    = trips.reduce((s,t)=>s+(t.paymentReceived||0),0);
  const totalOutstanding = trips.reduce((s,t)=>s+Math.max(0,(t.invoiceAmount||0)-(t.paymentReceived||0)),0);
  const overallMargin    = totalRevenue>0 ? Math.round((totalProfit/totalRevenue)*100) : 0;

  const spendByCat = CATEGORIES.map(c=>({
    ...c, total:expenses.filter(e=>e.category===c.id&&e.status!=="rejected").reduce((s,e)=>s+e.amount,0)
  })).sort((a,b)=>b.total-a.total);

  const filtered = expenses.filter(e=>
    (filterTrip  ==="all"||e.tripId  ===filterTrip)   &&
    (filterStatus==="all"||e.status  ===filterStatus)  &&
    (filterCat   ==="all"||e.category===filterCat)     &&
    (!search||e.description?.toLowerCase().includes(search.toLowerCase()))
  );

  // ── Shared styles ───────────────────────────────────────────────────────────
  const card   = { background:WH, border:`1px solid ${BD}`, borderRadius:16, padding:24 };
  const cardGr = { background:GRL, border:`1.5px solid ${GRB}`, borderRadius:16, padding:24 };
  const cardRd = { background:RDL, border:`1.5px solid ${RDB}`, borderRadius:16, padding:24 };
  const cardOr = { background:OL,  border:`1.5px solid ${OM}`,  borderRadius:16, padding:24 };
  const btnOr  = { background:O, border:"none", borderRadius:10, padding:"10px 20px", color:WH, fontSize:13, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:6, fontFamily:"inherit" };
  const btnGh  = { background:WH, border:`1px solid ${BD}`, borderRadius:8, padding:"7px 14px", color:T2, fontSize:12, cursor:"pointer", fontFamily:"inherit" };
  const pgTitle= { fontSize:26, fontWeight:800, color:TX, letterSpacing:"-0.03em" };
  const secTtl = { fontSize:15, fontWeight:700, color:TX, marginBottom:18 };
  const lbl    = { color:T3, fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:3 };
  const divider= { height:1, background:BD, margin:"16px 0" };
  const inp    = { background:BG, border:`1.5px solid ${BD}`, borderRadius:10, padding:"9px 14px", color:TX, fontSize:13, outline:"none", boxSizing:"border-box", fontFamily:"inherit" };
  const navItem= active=>({ display:"flex", alignItems:"center", gap:12, padding:"9px 14px", borderRadius:10, cursor:"pointer", marginBottom:2, background:active?O:"transparent", color:active?WH:T2, fontSize:14, fontWeight:active?700:400, transition:"all 0.18s" });

  // ── Loading / Auth gates ────────────────────────────────────────────────────
  if (currentUser === undefined) {
    return (
      <div style={{ minHeight:"100vh", background:BG, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Plus Jakarta Sans', sans-serif" }}>
        <div style={{ textAlign:"center" }}>
          <Spinner size={40}/>
          <div style={{ color:T2, fontSize:14, marginTop:16 }}>Connecting to Firebase…</div>
        </div>
      </div>
    );
  }

  if (!currentUser) return <LoginScreen/>;

  // ════════════════════════════════════════════════════════════════════════════
  // DASHBOARD
  // ════════════════════════════════════════════════════════════════════════════
  const Dashboard = () => (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:28 }}>
        <div>
          <div style={pgTitle}>Good morning 👋</div>
          <div style={{ color:T2, fontSize:14, marginTop:5 }}>Signed in as <strong>{currentUser.email}</strong> · Live from Firebase</div>
        </div>
        <div style={{ display:"flex", gap:10 }}>
          <button style={{ ...btnGh }} onClick={()=>setShowAddTrip(true)}>+ New Trip</button>
          <button style={btnOr} onClick={()=>setShowAdd(true)}><span style={{ fontSize:18 }}>+</span> Log Expense</button>
        </div>
      </div>

      {dbLoading ? (
        <div style={{ textAlign:"center", padding:"80px 0" }}><Spinner size={36}/><div style={{ color:T2, fontSize:14, marginTop:16 }}>Loading from Firestore…</div></div>
      ) : (
        <>
          {/* P&L Banner */}
          <div style={{ ...(totalProfit>=0?cardGr:cardRd), marginBottom:20, display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:16 }}>
            <div>
              <div style={{ fontSize:12, fontWeight:700, color:totalProfit>=0?"#059669":"#DC2626", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:6 }}>
                {totalProfit>=0?"▲ Business is in Profit":"▼ Business is in Loss"}
              </div>
              <div style={{ fontSize:40, fontWeight:800, color:totalProfit>=0?"#059669":"#DC2626", letterSpacing:"-0.03em" }}>
                <AnimNum value={totalProfit}/>
              </div>
              <div style={{ color:T2, fontSize:13, marginTop:6 }}>Overall margin: <strong style={{ color:totalProfit>=0?"#059669":"#DC2626" }}>{overallMargin}%</strong> · {trips.length} trips · {expenses.length} expenses in Firebase</div>
            </div>
            <div style={{ display:"flex", gap:24, flexWrap:"wrap" }}>
              {[["Revenue",totalRevenue,BL,"💰"],["Expenses",totalSpend,RD,"💸"],["Received",totalReceived,GR,"✅"],["Outstanding",totalOutstanding,YL,"⏳"]].map(([l,v,c,ic])=>(
                <div key={l} style={{ textAlign:"center" }}>
                  <div style={{ fontSize:11, color:T3, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>{ic} {l}</div>
                  <div style={{ fontSize:20, fontWeight:800, color:c, marginTop:4 }}>{fmt(v)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* KPI row */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:20 }}>
            {[
              { label:"Total Budget",   value:trips.reduce((s,t)=>s+(t.budget||0),0), color:O,  spark:[3,5,4,7,6,8,9], icon:"💼" },
              { label:"Total Invoiced", value:totalRevenue,                            color:BL, spark:[2,4,3,6,5,7,8], icon:"🧾" },
              { label:"Total Spent",    value:totalSpend,                              color:RD, spark:[1,3,2,5,4,6,7], icon:"💸" },
              { label:"Pending Items",  value:pending.length,                          color:YL, spark:[1,2,3,2,4,3,5], icon:"⏳", noRupee:true },
            ].map(({label,value,color,spark,icon,noRupee})=>(
              <div key={label} style={{ ...card, position:"relative", overflow:"hidden" }}>
                <div style={{ position:"absolute", top:0, left:0, right:0, height:3, background:color, borderRadius:"16px 16px 0 0" }}/>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
                  <div style={lbl}>{label}</div>
                  <span style={{ fontSize:18 }}>{icon}</span>
                </div>
                <div style={{ fontSize:21, fontWeight:800, color:TX, marginBottom:12 }}>
                  {noRupee ? value : <AnimNum value={value}/>}
                </div>
                <SparkBar values={spark} color={color}/>
              </div>
            ))}
          </div>

          {/* Trip P&L cards */}
          {plData.length > 0 && (
            <div style={{ marginBottom:20 }}>
              <div style={{ ...secTtl, marginBottom:14 }}>Trip Profit & Loss — Live from Firebase</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:14 }}>
                {plData.map(t=>{
                  const isProfit=t.profit>=0;
                  return (
                    <div key={t.id} style={{ ...card, borderTop:`3px solid ${isProfit?GR:RD}` }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
                        <div>
                          <div style={{ fontSize:13, fontWeight:700, color:TX }}>{t.name}</div>
                          <div style={{ fontSize:11, color:T3, marginTop:2 }}>{t.client}</div>
                        </div>
                        <StatusBadge s={t.paymentStatus||"unpaid"}/>
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:12 }}>
                        {[["Revenue",fmt(t.revenue),BL],["Expenses",fmt(t.spent),RD]].map(([l,v,c])=>(
                          <div key={l} style={{ background:BG, borderRadius:8, padding:"8px 10px" }}>
                            <div style={{ fontSize:10, color:T3, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>{l}</div>
                            <div style={{ fontSize:14, fontWeight:800, color:c, marginTop:2 }}>{v}</div>
                          </div>
                        ))}
                      </div>
                      <div style={divider}/>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <div>
                          <div style={{ fontSize:10, color:T3, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>{isProfit?"Profit":"Loss"}</div>
                          <div style={{ fontSize:20, fontWeight:800, color:isProfit?GR:RD, marginTop:2 }}>{fmtSgn(t.profit)}</div>
                        </div>
                        <div style={{ textAlign:"right" }}>
                          <div style={{ fontSize:10, color:T3, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>Margin</div>
                          <div style={{ fontSize:20, fontWeight:800, color:isProfit?GR:RD, marginTop:2 }}>{t.margin}%</div>
                        </div>
                      </div>
                      <button onClick={()=>setEditRevTrip(t)} style={{ ...btnGh, width:"100%", marginTop:14, justifyContent:"center", display:"flex" }}>✏️ Edit Revenue</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* No trips yet */}
          {trips.length===0&&!dbLoading&&(
            <div style={{ ...card, textAlign:"center", padding:"60px 0", marginBottom:20 }}>
              <div style={{ fontSize:48, marginBottom:16 }}>✈️</div>
              <div style={{ fontSize:18, fontWeight:700, color:TX, marginBottom:8 }}>No trips yet</div>
              <div style={{ color:T2, fontSize:14, marginBottom:24 }}>Create your first trip to start tracking expenses</div>
              <button style={{ ...btnOr, margin:"0 auto" }} onClick={()=>setShowAddTrip(true)}>+ Create First Trip</button>
            </div>
          )}

          {/* Pending approvals */}
          {pending.length>0&&(
            <div style={{ ...cardOr, marginBottom:20 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
                <div style={{ width:9, height:9, borderRadius:"50%", background:O }}/>
                <div style={{ ...secTtl, marginBottom:0, color:OD }}>Pending Approvals — {pending.length} items</div>
              </div>
              {pending.map(e=>{
                const trip=trips.find(t=>t.id===e.tripId); const cat=catOf(e.category);
                return (
                  <div key={e.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 0", borderBottom:`1px solid ${OM}` }}>
                    <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                      <div style={{ width:38, height:38, borderRadius:10, background:WH, display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, flexShrink:0, border:`1px solid ${OM}` }}>{cat.icon}</div>
                      <div>
                        <div style={{ fontSize:13, fontWeight:700, color:TX }}>{e.description}</div>
                        <div style={{ fontSize:11, color:T2, marginTop:2 }}>{trip?.name} · {e.submittedBy}</div>
                      </div>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0, marginLeft:16 }}>
                      <span style={{ fontSize:15, fontWeight:800, color:TX }}>{fmt(e.amount)}</span>
                      <button onClick={()=>approveExp(e.id)} style={{ background:GR, border:"none", color:WH, borderRadius:8, padding:"6px 14px", fontSize:12, cursor:"pointer", fontWeight:700, fontFamily:"inherit" }}>Approve</button>
                      <button onClick={()=>rejectExp(e.id)}  style={{ background:WH, border:`1px solid ${BD}`, color:T2, borderRadius:8, padding:"6px 12px", fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Reject</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {expenses.length>0&&(
            <div style={card}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                <div style={secTtl}>Recent Expenses</div>
                <button style={btnGh} onClick={()=>setTab("expenses")}>View all →</button>
              </div>
              <ExpenseTable rows={expenses.slice(0,5)} trips={trips} onApprove={approveExp} onReject={rejectExp}/>
            </div>
          )}
        </>
      )}
    </div>
  );

  // ════════════════════════════════════════════════════════════════════════════
  // P&L PAGE
  // ════════════════════════════════════════════════════════════════════════════
  const ProfitLoss = () => {
    const maxRev = Math.max(...plData.map(t=>t.revenue),1);
    return (
      <div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:28 }}>
          <div><div style={pgTitle}>Profit & Loss</div><div style={{ color:T2, fontSize:14, marginTop:5 }}>Live from Firebase · auto-updates</div></div>
          <PLBadge value={totalProfit}/>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:24 }}>
          {[
            { label:"Total Revenue",  value:totalRevenue,   color:BL, bg:BLL, icon:"💰", sub:"Invoiced to clients" },
            { label:"Total Expenses", value:totalSpend,     color:RD, bg:RDL, icon:"💸", sub:"Approved + pending"  },
            { label:"Net P&L",        value:totalProfit,    color:totalProfit>=0?GR:RD, bg:totalProfit>=0?GRL:RDL, icon:totalProfit>=0?"📈":"📉", sub:`${overallMargin}% margin` },
            { label:"Cash Received",  value:totalReceived,  color:GR, bg:GRL, icon:"✅", sub:`${fmt(totalOutstanding)} outstanding` },
          ].map(({label,value,color,bg,icon,sub})=>(
            <div key={label} style={{ background:bg, border:`1.5px solid ${color}33`, borderRadius:16, padding:20 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
                <div style={{ fontSize:11, fontWeight:700, color:T2, letterSpacing:"0.07em", textTransform:"uppercase" }}>{label}</div>
                <span style={{ fontSize:20 }}>{icon}</span>
              </div>
              <div style={{ fontSize:24, fontWeight:800, color, marginBottom:4 }}>{value<0?"−":""}{fmt(Math.abs(value))}</div>
              <div style={{ fontSize:11, color:T2 }}>{sub}</div>
            </div>
          ))}
        </div>

        <div style={{ ...card, marginBottom:20 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
            <div style={secTtl}>Per-Trip Breakdown</div>
          </div>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead><tr>{["Trip","Client","Revenue","Expenses","Profit/Loss","Margin","Payment","Action"].map(h=>(
                <th key={h} style={{ textAlign:"left", padding:"10px 14px", color:T3, fontSize:11, fontWeight:700, letterSpacing:"0.07em", textTransform:"uppercase", borderBottom:`1.5px solid ${BD}`, background:BG, whiteSpace:"nowrap" }}>{h}</th>
              ))}</tr></thead>
              <tbody>
                {plData.map((t,i)=>{
                  const ip=t.profit>=0;
                  return (
                    <tr key={t.id} style={{ background:i%2===0?WH:BG, borderBottom:`1px solid ${BD}` }}
                      onMouseEnter={ev=>ev.currentTarget.style.background=OL}
                      onMouseLeave={ev=>ev.currentTarget.style.background=i%2===0?WH:BG}>
                      <td style={{ padding:"14px 14px" }}><div style={{ fontWeight:700, color:TX }}>{t.name}</div><div style={{ fontSize:11, color:T3, marginTop:2 }}>📍 {t.destination}</div></td>
                      <td style={{ padding:"14px 14px", color:T2 }}>{t.client}</td>
                      <td style={{ padding:"14px 14px", fontWeight:700, color:BL }}>{fmt(t.revenue)}</td>
                      <td style={{ padding:"14px 14px", fontWeight:700, color:RD }}>{fmt(t.spent)}</td>
                      <td style={{ padding:"14px 14px" }}><div style={{ fontWeight:800, fontSize:15, color:ip?GR:RD }}>{fmtSgn(t.profit)}</div></td>
                      <td style={{ padding:"14px 14px" }}><span style={{ fontWeight:800, color:ip?GR:RD, fontSize:15 }}>{t.margin}%</span></td>
                      <td style={{ padding:"14px 14px" }}><StatusBadge s={t.paymentStatus||"unpaid"}/></td>
                      <td style={{ padding:"14px 14px" }}><button onClick={()=>setEditRevTrip(t)} style={{ ...btnGh, fontSize:11, padding:"5px 10px" }}>✏️ Edit</button></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background:BG, borderTop:`2px solid ${BD}` }}>
                  <td colSpan={2} style={{ padding:"14px 14px", fontWeight:800, color:TX, fontSize:14 }}>TOTAL</td>
                  <td style={{ padding:"14px 14px", fontWeight:800, color:BL, fontSize:14 }}>{fmt(totalRevenue)}</td>
                  <td style={{ padding:"14px 14px", fontWeight:800, color:RD, fontSize:14 }}>{fmt(totalSpend)}</td>
                  <td style={{ padding:"14px 14px" }}><span style={{ fontWeight:800, fontSize:16, color:totalProfit>=0?GR:RD }}>{fmtSgn(totalProfit)}</span></td>
                  <td style={{ padding:"14px 14px" }}><span style={{ fontWeight:800, color:totalProfit>=0?GR:RD, fontSize:15 }}>{overallMargin}%</span></td>
                  <td colSpan={2}/>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
          <div style={card}>
            <div style={secTtl}>Revenue vs Expenses</div>
            {plData.map(t=>(
              <div key={t.id} style={{ marginBottom:18 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                  <span style={{ fontSize:13, fontWeight:600, color:TX }}>{t.name.slice(0,22)}</span>
                  <PLBadge value={t.profit}/>
                </div>
                <div style={{ marginBottom:5 }}>
                  <div style={{ fontSize:10, color:T3, fontWeight:700, marginBottom:3, textTransform:"uppercase" }}>Revenue — {fmt(t.revenue)}</div>
                  <HBar value={t.revenue} max={maxRev} color={BL}/>
                </div>
                <div>
                  <div style={{ fontSize:10, color:T3, fontWeight:700, marginBottom:3, textTransform:"uppercase" }}>Expenses — {fmt(t.spent)}</div>
                  <HBar value={t.spent} max={maxRev} color={t.spent>t.revenue?RD:O}/>
                </div>
              </div>
            ))}
          </div>

          <div style={card}>
            <div style={secTtl}>Client Payment Collection</div>
            {trips.map(t=>{
              const recv=t.paymentReceived||0;
              const outs=Math.max(0,(t.invoiceAmount||0)-recv);
              return (
                <div key={t.id} style={{ marginBottom:20 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                    <div><div style={{ fontSize:13, fontWeight:700, color:TX }}>{t.name}</div><div style={{ fontSize:11, color:T3, marginTop:2 }}>{t.client}</div></div>
                    <StatusBadge s={t.paymentStatus||"unpaid"}/>
                  </div>
                  <HBar value={recv} max={t.invoiceAmount||1} color={GR} height={10}/>
                  <div style={{ display:"flex", justifyContent:"space-between", marginTop:5 }}>
                    <span style={{ fontSize:11, color:GR, fontWeight:700 }}>✓ {fmt(recv)}</span>
                    {outs>0&&<span style={{ fontSize:11, color:YL, fontWeight:700 }}>⏳ {fmt(outs)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // ════════════════════════════════════════════════════════════════════════════
  // EXPENSES PAGE
  // ════════════════════════════════════════════════════════════════════════════
  const Expenses = () => (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:28 }}>
        <div><div style={pgTitle}>All Expenses</div><div style={{ color:T2, fontSize:14, marginTop:5 }}>{filtered.length} records · {fmt(filtered.reduce((s,e)=>s+e.amount,0))} total</div></div>
        <button style={btnOr} onClick={()=>setShowAdd(true)}><span style={{ fontSize:18 }}>+</span> Log Expense</button>
      </div>
      <div style={{ ...card, marginBottom:16, display:"flex", gap:12, flexWrap:"wrap", alignItems:"center" }}>
        <input value={search} onChange={e=>setSR(e.target.value)} placeholder="🔍  Search expenses…" style={{ ...inp, width:220, flexShrink:0 }}/>
        {[
          { val:filterTrip,   fn:setFT, opts:[["all","All Trips"],   ...trips.map(t=>[t.id,t.name.slice(0,26)])] },
          { val:filterStatus, fn:setFS, opts:[["all","All Status"],  ["approved","✓ Approved"],["pending","⏳ Pending"],["rejected","✕ Rejected"]] },
          { val:filterCat,    fn:setFC, opts:[["all","All Categories"],...CATEGORIES.map(c=>[c.id,`${c.icon} ${c.label}`])] },
        ].map(({val,fn,opts},i)=>(
          <select key={i} value={val} onChange={e=>fn(e.target.value)} style={{ ...inp, minWidth:160, appearance:"none" }}>
            {opts.map(([v,l])=><option key={v} value={v}>{l}</option>)}
          </select>
        ))}
        {(filterTrip!=="all"||filterStatus!=="all"||filterCat!=="all"||search)&&
          <button onClick={()=>{setFT("all");setFS("all");setFC("all");setSR("");}} style={{ ...btnGh, color:RD, borderColor:RDB }}>✕ Clear</button>}
      </div>
      <div style={card}><ExpenseTable rows={filtered} trips={trips} onApprove={approveExp} onReject={rejectExp}/></div>
    </div>
  );

  // ════════════════════════════════════════════════════════════════════════════
  // TRIPS PAGE
  // ════════════════════════════════════════════════════════════════════════════
  const Trips = () => (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:28 }}>
        <div><div style={pgTitle}>Trips</div><div style={{ color:T2, fontSize:14, marginTop:5 }}>{trips.length} trips in Firebase</div></div>
        <button style={btnOr} onClick={()=>setShowAddTrip(true)}><span style={{ fontSize:18 }}>+</span> New Trip</button>
      </div>
      {trips.length===0&&<div style={{ ...card, textAlign:"center", padding:"60px 0" }}><div style={{ fontSize:48, marginBottom:16 }}>✈️</div><div style={{ fontSize:18, fontWeight:700, color:TX, marginBottom:8 }}>No trips yet</div><button style={{ ...btnOr, margin:"0 auto" }} onClick={()=>setShowAddTrip(true)}>+ Create First Trip</button></div>}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(310px,1fr))", gap:16 }}>
        {plData.map((t,idx)=>{
          const p=Math.min(100,pct(t.spent,t.budget||1));
          const barCol=p>80?RD:p>60?YL:GR;
          const accents=[O,BL,PU]; const ac=accents[idx%3];
          const te=expenses.filter(e=>e.tripId===t.id);
          return (
            <div key={t.id} style={{ ...card, cursor:"pointer", position:"relative", overflow:"hidden", transition:"box-shadow 0.22s, transform 0.22s" }}
              onMouseEnter={ev=>{ev.currentTarget.style.boxShadow="0 8px 32px rgba(242,101,34,0.13)";ev.currentTarget.style.transform="translateY(-3px)";}}
              onMouseLeave={ev=>{ev.currentTarget.style.boxShadow="none";ev.currentTarget.style.transform="translateY(0)";}}
              onClick={()=>setTD(t.id)}>
              <div style={{ position:"absolute", top:0, left:0, width:"100%", height:4, background:ac }}/>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12, marginTop:8 }}>
                <div><div style={{ fontSize:15, fontWeight:800, color:TX, lineHeight:1.3 }}>{t.name}</div><div style={{ color:T3, fontSize:12, marginTop:3 }}>📍 {t.destination}</div></div>
                <StatusBadge s={t.status||"active"}/>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:12 }}>
                {[["Revenue",fmt(t.revenue),BL],["Spent",fmt(t.spent),RD],["P&L",fmtSgn(t.profit),t.profit>=0?GR:RD]].map(([l,v,c])=>(
                  <div key={l} style={{ background:BG, borderRadius:8, padding:"8px 10px" }}>
                    <div style={{ fontSize:9, color:T3, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>{l}</div>
                    <div style={{ fontSize:13, fontWeight:800, color:c, marginTop:2 }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={divider}/>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                <span style={{ fontSize:12, color:T2 }}>Budget usage</span>
                <span style={{ fontSize:12, fontWeight:800, color:barCol }}>{p}%</span>
              </div>
              <HBar value={t.spent} max={t.budget||1} color={barCol} height={7}/>
              <div style={{ marginTop:10, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ fontSize:11, color:T3 }}>{te.length} expenses · {te.filter(e=>e.status==="pending").length} pending</div>
                <StatusBadge s={t.paymentStatus||"unpaid"}/>
              </div>
            </div>
          );
        })}
      </div>

      {tripDetail&&(()=>{
        const t=plData.find(x=>x.id===tripDetail);
        if (!t) return null;
        const te=expenses.filter(e=>e.tripId===tripDetail);
        return (
          <div style={{ position:"fixed", inset:0, background:"rgba(26,26,46,0.45)", zIndex:900, display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(4px)" }}>
            <div style={{ background:WH, borderRadius:20, padding:36, width:720, maxWidth:"95vw", maxHeight:"85vh", overflowY:"auto", boxShadow:"0 24px 80px rgba(0,0,0,0.15)", border:`1px solid ${BD}` }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:24 }}>
                <div><div style={{ fontSize:22, fontWeight:800, color:TX }}>{t.name}</div><div style={{ color:T2, fontSize:13, marginTop:4 }}>📍 {t.destination} · {t.client}</div></div>
                <button onClick={()=>setTD(null)} style={{ background:BG, border:`1px solid ${BD}`, color:T2, width:34, height:34, borderRadius:"50%", cursor:"pointer", fontSize:18, display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:24 }}>
                {[["Revenue",fmt(t.revenue),BL],["Spent",fmt(t.spent),RD],["P&L",fmtSgn(t.profit),t.profit>=0?GR:RD],["Margin",`${t.margin}%`,t.margin>=0?GR:RD]].map(([l,v,c])=>(
                  <div key={l} style={{ background:BG, borderRadius:12, padding:"14px 16px", border:`1px solid ${BD}` }}>
                    <div style={lbl}>{l}</div>
                    <div style={{ fontSize:20, fontWeight:800, color:c }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize:14, fontWeight:700, color:TX, marginBottom:12 }}>Expenses ({te.length})</div>
              <ExpenseTable rows={te} trips={trips} onApprove={approveExp} onReject={rejectExp}/>
              <button onClick={()=>{setTD(null);setEditRevTrip(t);}} style={{ ...btnOr, marginTop:16 }}>✏️ Edit Revenue & Payment</button>
            </div>
          </div>
        );
      })()}
    </div>
  );

  // ════════════════════════════════════════════════════════════════════════════
  // REPORTS
  // ════════════════════════════════════════════════════════════════════════════
  const Reports = () => {
    const maxCat=Math.max(...spendByCat.map(c=>c.total),1);
    return (
      <div>
        <div style={{ marginBottom:28 }}><div style={pgTitle}>Reports</div><div style={{ color:T2, fontSize:14, marginTop:5 }}>Category & trip analytics</div></div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:20 }}>
          <div style={card}>
            <div style={secTtl}>Spend by Category</div>
            {spendByCat.filter(c=>c.total>0).map(c=>(
              <div key={c.id} style={{ marginBottom:16 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                  <span style={{ fontSize:13, color:TX, fontWeight:600 }}>{c.icon} {c.label}</span>
                  <span style={{ fontSize:13, fontWeight:800, color:TX }}>{fmt(c.total)}</span>
                </div>
                <HBar value={c.total} max={maxCat} color={c.color}/>
                <div style={{ fontSize:11, color:T3, marginTop:3 }}>{pct(c.total,totalSpend)}% of total</div>
              </div>
            ))}
            {spendByCat.every(c=>c.total===0)&&<div style={{ color:T3, textAlign:"center", padding:"24px 0" }}>No expense data yet</div>}
          </div>
          <div style={card}>
            <div style={secTtl}>Per-Trip Summary</div>
            {plData.map((t,i)=>{
              const colors=[O,BL,PU]; const c=colors[i%3];
              return (
                <div key={t.id} style={{ display:"flex", alignItems:"center", gap:14, marginBottom:20, paddingBottom:20, borderBottom:i<plData.length-1?`1px solid ${BD}`:"none" }}>
                  <Donut used={t.spent} total={t.budget||1} color={c}/>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:TX }}>{t.name}</div>
                    <div style={{ fontSize:11, color:T3, marginTop:2, marginBottom:6 }}>{t.client}</div>
                    <div style={{ fontSize:13, color:c, fontWeight:800 }}>{fmt(t.spent)} <span style={{ color:T3, fontWeight:400, fontSize:12 }}>/ {fmt(t.budget||0)} budget</span></div>
                    <div style={{ marginTop:4 }}><PLBadge value={t.profit}/></div>
                  </div>
                </div>
              );
            })}
            {plData.length===0&&<div style={{ color:T3, textAlign:"center", padding:"24px 0" }}>No trips yet</div>}
          </div>
        </div>
      </div>
    );
  };

  // ════════════════════════════════════════════════════════════════════════════
  // NAV + SHELL
  // ════════════════════════════════════════════════════════════════════════════
  const NAV = [
    { id:"dashboard", icon:"⊡", label:"Dashboard"     },
    { id:"pl",        icon:"📈", label:"Profit & Loss" },
    { id:"expenses",  icon:"≡",  label:"Expenses"      },
    { id:"trips",     icon:"✈",  label:"Trips"         },
    { id:"reports",   icon:"◎",  label:"Reports"       },
  ];

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0;}
        @keyframes spin{to{transform:rotate(360deg);}}
        @keyframes slideUp{from{transform:translateY(16px);opacity:0;}to{transform:translateY(0);opacity:1;}}
        ::-webkit-scrollbar{width:5px;height:5px;}
        ::-webkit-scrollbar-track{background:${BG};}
        ::-webkit-scrollbar-thumb{background:${OM};border-radius:4px;}
        input::placeholder{color:${T3};}
        input:focus,select:focus{border-color:${O}!important;box-shadow:0 0 0 3px ${OL};}
        select option{background:${WH};color:${TX};}
        button:hover{opacity:0.9;}
      `}</style>

      <div style={{ minHeight:"100vh", background:BG, color:TX, fontFamily:"'Plus Jakarta Sans', sans-serif", display:"flex" }}>

        {/* Toast */}
        {toast&&(
          <div style={{ position:"fixed", bottom:24, right:24, background:TX, color:WH, borderRadius:12, padding:"12px 20px", fontSize:14, fontWeight:600, zIndex:2000, boxShadow:"0 8px 32px rgba(0,0,0,0.18)", animation:"slideUp 0.3s ease", display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ width:8, height:8, borderRadius:"50%", background:O, flexShrink:0, display:"inline-block" }}/>
            {toast}
          </div>
        )}

        {/* Sidebar */}
        <div style={{ width:248, background:WH, borderRight:`1.5px solid ${BD}`, display:"flex", flexDirection:"column", padding:"24px 0", flexShrink:0, position:"sticky", top:0, height:"100vh", overflowY:"auto" }}>
          <div style={{ padding:"0 20px 24px", borderBottom:`1px solid ${BD}` }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:38, height:38, borderRadius:10, background:O, display:"flex", alignItems:"center", justifyContent:"center", fontSize:19, color:WH, flexShrink:0 }}>✈</div>
              <div>
                <div style={{ fontSize:17, fontWeight:800, color:TX, letterSpacing:"-0.02em" }}>ExpensePro</div>
                <div style={{ fontSize:10, color:T3, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase" }}>Travel Agency</div>
              </div>
            </div>
          </div>

          <nav style={{ padding:"16px 12px", flex:1 }}>
            <div style={{ fontSize:10, color:T3, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", padding:"0 12px", marginBottom:10 }}>Menu</div>
            {NAV.map(({id,icon,label})=>(
              <div key={id} style={navItem(tab===id)} onClick={()=>setTab(id)}>
                <span style={{ fontSize:15 }}>{icon}</span>
                <span>{label}</span>
                {id==="pl"&&trips.length>0&&<span style={{ marginLeft:"auto", background:totalProfit>=0?GR:RD, color:WH, fontSize:10, fontWeight:800, borderRadius:10, padding:"2px 7px" }}>{totalProfit>=0?"▲":"▼"}</span>}
                {id==="expenses"&&pending.length>0&&<span style={{ marginLeft:"auto", background:O, color:WH, fontSize:10, fontWeight:800, borderRadius:10, padding:"2px 8px" }}>{pending.length}</span>}
              </div>
            ))}
          </nav>

          {/* Sidebar P&L summary */}
          {trips.length>0&&(
            <div style={{ margin:"0 12px 12px", background:totalProfit>=0?GRL:RDL, border:`1px solid ${totalProfit>=0?GRB:RDB}`, borderRadius:12, padding:"12px 14px" }}>
              <div style={{ fontSize:10, color:T2, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Net P&L (Live)</div>
              <div style={{ fontSize:20, fontWeight:800, color:totalProfit>=0?"#059669":"#DC2626" }}>{fmtSgn(totalProfit)}</div>
              <div style={{ fontSize:11, color:T2, marginTop:2 }}>{overallMargin}% margin</div>
            </div>
          )}

          {/* Firebase indicator */}
          <div style={{ margin:"0 12px 12px", background:BLL, border:`1px solid ${BL}33`, borderRadius:12, padding:"10px 14px", display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ width:8, height:8, borderRadius:"50%", background:GR, flexShrink:0 }}/>
            <div style={{ fontSize:11, color:BL, fontWeight:700 }}>Connected to Firebase</div>
          </div>

          <div style={{ padding:"16px 20px", borderTop:`1px solid ${BD}` }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:34, height:34, borderRadius:"50%", background:O, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:800, color:WH, flexShrink:0 }}>
                  {currentUser.email?.[0]?.toUpperCase()||"U"}
                </div>
                <div>
                  <div style={{ fontSize:12, fontWeight:700, color:TX }}>{currentUser.email?.split("@")[0]}</div>
                  <div style={{ fontSize:10, color:T3 }}>{currentUser.email}</div>
                </div>
              </div>
              <button onClick={()=>signOut(auth)} style={{ background:"none", border:"none", color:T3, cursor:"pointer", fontSize:18, padding:"4px" }} title="Sign out">⏻</button>
            </div>
          </div>
        </div>

        {/* Main */}
        <div style={{ flex:1, display:"flex", flexDirection:"column", minWidth:0 }}>
          <div style={{ background:WH, borderBottom:`1.5px solid ${BD}`, padding:"14px 32px", display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, zIndex:10 }}>
            <div style={{ fontSize:13, color:T2, fontWeight:500, display:"flex", alignItems:"center", gap:8 }}>
              <span>🔥 Firebase Live</span>
              <span style={{ color:BD }}>·</span>
              <span>{new Date().toLocaleDateString("en-IN",{day:"numeric",month:"long",year:"numeric"})}</span>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <div style={{ background:GRL, border:`1px solid ${GRB}`, borderRadius:8, padding:"5px 12px", fontSize:12, color:GR, fontWeight:700 }}>● Live</div>
              <button style={{ ...btnGh }} onClick={()=>setShowAddTrip(true)}>+ Trip</button>
              <button style={btnOr} onClick={()=>setShowAdd(true)}>+ Expense</button>
            </div>
          </div>
          <div style={{ padding:"28px 32px", flex:1 }}>
            {tab==="dashboard"&&<Dashboard/>}
            {tab==="pl"       &&<ProfitLoss/>}
            {tab==="expenses" &&<Expenses/>}
            {tab==="trips"    &&<Trips/>}
            {tab==="reports"  &&<Reports/>}
          </div>
        </div>
      </div>

      {showAdd     &&<AddExpenseModal  onClose={()=>setShowAdd(false)}     trips={trips} currentUser={currentUser} notify={notify}/>}
      {showAddTrip &&<AddTripModal     onClose={()=>setShowAddTrip(false)} notify={notify}/>}
      {editRevTrip &&<EditRevenueModal trip={editRevTrip} onClose={()=>setEditRevTrip(null)} notify={notify}/>}
    </>
  );
}
'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { SYSTEM_VERSION } from '@/lib/constants';

export default function UserGuidePage() {
    const [activeSection, setActiveSection] = useState('overview');

    const sections = [
        { id: 'overview', title: 'ภาพรวมระบบ', icon: '🌈', desc: 'System Overview' },
        { id: 'admin', title: 'การใช้งาน Admin', icon: '🛠️', desc: 'Master Control Guide' },
        { id: 'player', title: 'Node Device Client', icon: '🖥️', desc: 'Device Setup & Maintenance' },
        { id: 'setup', title: 'การติดตั้ง Player', icon: '⚙️', desc: 'Installation Steps' },
    ];

    const quickSteps = [
        { title: "1. คลังสื่อ (Media Library)", desc: "รองรับการอัปโหลดแบบ Safe Mode หรือ Smart Async โดยระบบจะคำนวณ Ratio และเวลาให้อัตโนมัติ" },
        { title: "2. การค้นหา (Search)", desc: "ค้นหาสื่อจาก ชื่อ, รหัสคู่ค้า, Ratio, หรือความยาวไฟล์ เพื่อความรวดเร็ว" },
        { title: "3. ระบบจัดการ Playlist", desc: "ลากและวางสื่อจัดลำดับ และกำหนดเวลาแสดงผลพิเศษ (Duration Override) ได้" },
        { title: "4. การเชื่อมต่ออุปกรณ์", desc: "Sync อัตโนมัติผ่าน LAN/Cloud และ Monitor สถานะแบบ Real-time" }
    ];

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-primary/20">
            <div className="max-w-[1400px] mx-auto flex flex-col lg:flex-row gap-8 p-6 lg:p-12">

                {/* --- Left Sidebar (Desktop) --- */}
                <aside className="lg:w-80 flex-shrink-0 space-y-8">
                    <div className="space-y-4">
                        <div className="inline-block px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-bold tracking-widest uppercase mb-2">
                            System v{SYSTEM_VERSION}
                        </div>
                        <h1 className="text-4xl font-black tracking-tighter uppercase leading-none italic">
                            Unicorn <br />
                            <span className="text-primary italic">Guide</span>
                        </h1>
                        <p className="text-muted-foreground text-sm font-medium">Documentation & Resource Hub</p>
                    </div>

                    <nav className="space-y-1">
                        {sections.map((s) => (
                            <button
                                key={s.id}
                                onClick={() => setActiveSection(s.id)}
                                className={`w-full group px-4 py-3 rounded-xl flex items-center gap-3 transition-all text-left ${activeSection === s.id
                                    ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                                    : 'hover:bg-muted text-muted-foreground hover:text-foreground border border-transparent'
                                    }`}
                            >
                                <span className={`text-xl transition-transform group-hover:scale-110 ${activeSection === s.id ? 'opacity-100' : 'opacity-50'}`}>
                                    {s.icon}
                                </span>
                                <div className="flex flex-col">
                                    <span className="text-sm font-bold leading-tight">{s.title}</span>
                                    <span className={`text-xs font-medium opacity-60 uppercase tracking-wider ${activeSection === s.id ? 'text-primary-foreground' : 'text-muted-foreground'}`}>
                                        {s.desc}
                                    </span>
                                </div>
                            </button>
                        ))}
                    </nav>

                    <div className="pt-8 border-t border-border/50">
                        <Link
                            href="/admin/changelog"
                            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-accent-purple/10 border border-accent-purple/20 text-accent-purple text-xs font-black uppercase tracking-widest hover:bg-accent-purple/20 transition-all"
                        >
                            <span>📝</span> Patch History
                        </Link>
                    </div>
                </aside>

                {/* --- Main Content Area --- */}
                <main className="flex-1 min-w-0">
                    <div className="bg-card-solid border border-border/50 rounded-[2.5rem] shadow-2xl p-8 lg:p-12 min-h-[800px] relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/5 blur-[120px] -z-10 rounded-full -translate-y-1/2 translate-x-1/2" />

                        {/* --- Page: Overview --- */}
                        {activeSection === 'overview' && (
                            <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                <header className="space-y-4">
                                    <h2 className="text-5xl font-black text-foreground uppercase tracking-tighter">Rainbow Signage <br /><span className="text-primary italic">Ecosystem</span></h2>
                                    <p className="text-muted-foreground leading-relaxed text-lg max-w-2xl font-medium">
                                        ระบบบริหารจัดการสื่อประชาสัมพันธ์ส่วนกลางที่เน้นความง่ายและความทนทาน ออกแบบมาเพื่อรองรับโครงข่ายขนาด 800+ สกรีน
                                    </p>
                                </header>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {quickSteps.map((step, i) => (
                                        <div key={i} className="p-6 bg-muted/20 rounded-2xl border border-border/40 hover:border-primary/30 transition-colors group">
                                            <div className="text-primary font-bold text-xs mb-2 uppercase tracking-widest flex items-center gap-2">
                                                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                                                {step.title.split('.')[1]}
                                            </div>
                                            <div className="text-sm text-muted-foreground leading-relaxed font-medium">{step.desc}</div>
                                        </div>
                                    ))}
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6">
                                    <div className="p-8 bg-accent-purple/5 rounded-[2rem] border border-accent-purple/15">
                                        <div className="text-4xl mb-6">🏠</div>
                                        <h4 className="font-black text-foreground mb-2 uppercase text-xs tracking-widest">Master Cloud</h4>
                                        <p className="text-xs text-muted-foreground leading-relaxed font-medium">Admin Dashboard สำหรับจัดการสื่อ, Playlist และสั่งการหน้าจอจากส่วนกลางผ่าน LAN/Cloud</p>
                                    </div>
                                    <div className="p-8 bg-primary/5 rounded-[2rem] border border-primary/15">
                                        <div className="text-4xl mb-6">🔄</div>
                                        <h4 className="font-black text-foreground mb-2 uppercase text-xs tracking-widest">Smart Sync</h4>
                                        <p className="text-xs text-muted-foreground leading-relaxed font-medium">ดาวน์โหลดสื่อเฉพาะส่วนที่เปลี่ยนใหม่เพื่อความรวดเร็วและไม่ขัดจังหวะการเล่นปัจจุบัน</p>
                                    </div>
                                    <div className="p-8 bg-green-500/5 rounded-[2rem] border border-green-500/15">
                                        <div className="text-4xl mb-6">🛡️</div>
                                        <h4 className="font-black text-foreground mb-2 uppercase text-xs tracking-widest">Offline Play</h4>
                                        <p className="text-xs text-muted-foreground leading-relaxed font-medium">ระบบที่ช่วยให้หน้าจอยังคงเล่นสื่อต่อไปได้ตลอด 24 ชม. แม้การเชื่อมต่ออินเทอร์เน็ตจะขัดข้อง</p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* --- Page: Admin --- */}
                        {activeSection === 'admin' && (
                            <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                <header className="space-y-4">
                                    <h2 className="text-5xl font-black text-foreground uppercase tracking-tighter">Admin Master <span className="text-accent-cyan italic">Control</span></h2>
                                    <p className="text-muted-foreground leading-relaxed text-lg max-w-2xl font-medium">
                                        สำหรับผู้ดูแลระบบส่วนกลาง (God View) รองรับการบริหารจัดการสื่อ อุปกรณ์ และการกระจายข้อมูลแบบเรียลไทม์
                                    </p>
                                </header>

                                {/* Unified Network Config Box */}
                                <div className="p-8 bg-primary/5 rounded-[2rem] border border-primary/20 relative border-l-8 border-l-primary">
                                    <div className="flex justify-between items-center mb-6">
                                        <h4 className="text-primary font-black uppercase text-sm tracking-widest">Unified Network Config</h4>
                                        <span className="px-3 py-1 bg-primary/20 rounded-full text-xs font-black">AUTOMATION MODE</span>
                                    </div>
                                    <p className="text-muted-foreground text-sm leading-relaxed mb-6 font-medium">
                                        เมื่อย้าย Server หรือเปลี่ยนพอร์ต สามารถแก้ไขได้ทันทีผ่าน <strong>Settings {'>'} System Config</strong> โดยระบบจะจัดการทรัพยากรเหล่านี้ให้อัตโนมัติ:
                                    </p>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div className="p-4 bg-muted/20 rounded-xl border border-border/50">
                                            <span className="block text-xs font-black text-foreground uppercase mb-1">API Backend</span>
                                            <p className="text-xs text-muted-foreground">แก้ไข <code>appsettings.json</code> ให้อัตโนมัติ</p>
                                        </div>
                                        <div className="p-4 bg-muted/20 rounded-xl border border-border/50">
                                            <span className="block text-xs font-black text-foreground uppercase mb-1">SQL Migration</span>
                                            <p className="text-xs text-muted-foreground">อัปเดต URL ของสื่อทุกชิ้นในฐานข้อมูล</p>
                                        </div>
                                        <div className="p-4 bg-muted/20 rounded-xl border border-border/50">
                                            <span className="block text-xs font-black text-foreground uppercase mb-1">Web Environment</span>
                                            <p className="text-xs text-muted-foreground">อัปเดตไฟล์ <code>.env</code> ของหน้า Dashboard</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    <div className="space-y-4">
                                        <h3 className="text-xl font-bold uppercase tracking-tight">Media Lifecycle (v2.3)</h3>
                                        <ul className="space-y-4 text-sm text-muted-foreground">
                                            <li className="flex gap-4">
                                                <span className="w-6 h-6 rounded-lg bg-accent-cyan/10 border border-accent-cyan/20 flex items-center justify-center text-accent-cyan text-xs font-bold shrink-0">01</span>
                                                <p><strong className="text-foreground">Upload & Expiry:</strong> ระบุ <strong>End Date</strong> (Optional) เมื่ออัปโหลด สื่อจะถูกระงับการใช้งานอัตโนมัติเมื่อถึงกำหนด</p>
                                            </li>
                                            <li className="flex gap-4">
                                                <span className="w-6 h-6 rounded-lg bg-accent-cyan/10 border border-accent-cyan/20 flex items-center justify-center text-accent-cyan text-xs font-bold shrink-0">02</span>
                                                <p><strong className="text-foreground">Status Logic:</strong> ‘Active’ คือพร้อมใช้งาน, ‘Inactive’ คือหมดอายุหรือถูกลบ (Soft Delete) สามารถ <strong>Restore</strong> กลับมาได้</p>
                                            </li>
                                            <li className="flex gap-4">
                                                <span className="w-6 h-6 rounded-lg bg-accent-cyan/10 border border-accent-cyan/20 flex items-center justify-center text-accent-cyan text-xs font-bold shrink-0">03</span>
                                                <p><strong className="text-foreground">Auto-Cleanup:</strong> Background Worker จะตรวจสอบสื่อหมดอายุทุก 6 ชม. หรือสั่ง <strong>"Check Expiry"</strong> ได้ทันทีจาก Toolbar</p>
                                            </li>
                                        </ul>
                                    </div>

                                    <div className="space-y-4">
                                        <h3 className="text-xl font-bold uppercase tracking-tight">System Glossary</h3>
                                        <div className="grid grid-cols-2 gap-3">
                                            {[
                                                { k: 'Node', v: 'หน้าจอปลายทาง' },
                                                { k: 'Asset', v: 'ไฟล์สื่อในระบบ' },
                                                { k: 'PoP', v: 'Proof of Play' },
                                                { k: 'Sync', v: 'การประสานข้อมูล' }
                                            ].map((item, i) => (
                                                <div key={i} className="p-3 bg-muted/10 rounded-xl border border-border/50">
                                                    <span className="block text-xs font-black text-foreground uppercase">{item.k}</span>
                                                    <span className="text-xs text-muted-foreground font-medium">{item.v}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* --- Page: Node Device Client --- */}
                        {activeSection === 'player' && (
                            <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                <header className="space-y-4">
                                    <h2 className="text-5xl font-black text-foreground uppercase tracking-tighter">Node Device <span className="text-accent-purple italic">Client</span></h2>
                                    <p className="text-muted-foreground leading-relaxed text-lg max-w-2xl font-medium">
                                        เจาะลึกการทำงานของแอปพลิเคชันปลายทาง (Player) และการบำรุงรักษาโดยช่างเทคนิค
                                    </p>
                                </header>

                                {/* Technical Callout */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="p-6 bg-accent-purple/5 rounded-3xl border border-accent-purple/20 space-y-4">
                                        <h4 className="text-accent-purple font-black text-xs uppercase tracking-widest flex items-center gap-2">
                                            <span>SQLite Engine & Robust Sync</span>
                                        </h4>
                                        <p className="text-xs text-muted-foreground leading-relaxed font-medium">
                                            เวอร์ชัน 2.0+ ใช้ <strong>Native SQLite</strong> ในการจัดการ Playlist และ Log (รองรับ 100k+ records) พร้อมระบบ <strong>Priority Queue</strong> ดาวน์โหลดสื่ออย่างมีลำดับและ <strong>Background Swap</strong> เปลี่ยนสื่อเมื่อพร้อมเท่านั้น
                                        </p>
                                    </div>
                                    <div className="p-6 bg-primary/5 rounded-3xl border border-primary/20 space-y-4">
                                        <h4 className="text-primary font-black text-xs uppercase tracking-widest flex items-center gap-2">
                                            <span>Proof of Play (PoP)</span>
                                        </h4>
                                        <p className="text-xs text-muted-foreground leading-relaxed font-medium">
                                            ทุกครั้งที่คลิปเล่นจบ เครื่องจะบันทึก Log ลงใน <strong>Local Queue</strong> และจะ Sync ไปยัง Server ทุกๆ 15 วินาที หรือเมื่อมีอินเทอร์เน็ต
                                        </p>
                                    </div>
                                </div>

                                {/* Hotkeys Table */}
                                <div className="space-y-6">
                                    <h3 className="text-2xl font-black uppercase tracking-tight italic border-l-4 border-accent-purple pl-6">Maintenance Hotkeys</h3>
                                    <div className="overflow-hidden rounded-2xl border border-border/50 bg-muted/10">
                                        <table className="w-full text-sm text-left">
                                            <thead className="bg-muted text-xs font-black uppercase tracking-widest">
                                                <tr>
                                                    <th className="px-6 py-4">Key</th>
                                                    <th className="px-6 py-4">Action</th>
                                                    <th className="px-6 py-4">Description</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border/50">
                                                {[
                                                    { k: 'F1', a: 'Help', d: 'แสดงเมนูช่วยเหลือ (HUD)' },
                                                    { k: 'F5', a: 'Restart', d: 'โหลดแอปใหม่กรณีหน้าจอค้าง' },
                                                    { k: 'F6', a: 'Force Sync', d: 'บังคับตรวจสอบ Playlist ทันที' },
                                                    { k: 'F7', a: 'Dashboard', d: 'เปิด Terminal สำหรับช่างเทคนิค' },
                                                    { k: 'F8', a: 'Reset Loop', d: 'เริ่มเล่นคลิปแรกสุดของรายการ' }
                                                ].map((row, i) => (
                                                    <tr key={i} className="hover:bg-muted/30 transition-colors">
                                                        <td className="px-6 py-4 font-black text-accent-purple">{row.k}</td>
                                                        <td className="px-6 py-4 font-bold text-foreground">{row.a}</td>
                                                        <td className="px-6 py-4 text-muted-foreground font-medium italic">{row.d}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                {/* Troubleshooting Section */}
                                <div className="p-8 bg-muted/20 rounded-[2.5rem] border border-border/50">
                                    <h3 className="text-xl font-black uppercase tracking-tight mb-6 flex items-center gap-3">
                                        <span className="text-yellow-500">⚠️</span> Basic Troubleshooting
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        <div className="space-y-3">
                                            <span className="text-xs font-black uppercase text-foreground">เมื่อสื่อไม่อัปเดต</span>
                                            <p className="text-xs text-muted-foreground leading-relaxed">
                                                กด <strong>F6 (Force Sync)</strong> เพื่อตรวจสอบ Manifest กับ Server ทันที
                                            </p>
                                        </div>
                                        <div className="space-y-3">
                                            <span className="text-xs font-black uppercase text-foreground">เมื่อหน้าจอดำหรือโปรแกรมค้าง</span>
                                            <p className="text-xs text-muted-foreground leading-relaxed">
                                                กด <strong>F5</strong> เพื่อรีสตาร์ท Logic ของหน้าเว็บใหม่ หรือใช้ปุ่ม Refresh ใน Admin Dashboard
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* --- Page: Setup --- */}
                        {activeSection === 'setup' && (
                            <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                <header className="space-y-4">
                                    <h2 className="text-5xl font-black text-foreground uppercase tracking-tighter">Device <span className="text-green-500 italic">Installation</span></h2>
                                    <p className="text-muted-foreground leading-relaxed text-lg max-w-2xl font-medium">
                                        ขั้นตอนการติดตั้งเครื่องชิ้นแรกและการตั้งค่า Kiosk Mode สำหรับ Windows
                                    </p>
                                </header>

                                <div className="space-y-8">
                                    <section className="p-8 bg-muted/10 rounded-[2.5rem] border border-border/50">
                                        <h4 className="text-foreground font-black mb-4 uppercase text-sm tracking-widest flex items-center gap-2">
                                            <span className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs">1</span>
                                            Chrome Kiosk Setup
                                        </h4>
                                        <p className="text-muted-foreground text-sm mb-6 leading-relaxed">สร้าง Shortcut ของ Google Chrome แล้วเติม Parameter ในช่อง <strong>Target</strong>:</p>
                                        <code className="block bg-black p-6 rounded-2xl border border-border/20 text-green-400 font-mono text-xs select-all leading-relaxed whitespace-pre-wrap">
                                            --kiosk http://YOUR_SERVER_IP:3000/player --autoplay-policy=no-user-gesture-required --disk-cache-size=1073741824 --disable-infobars --no-first-run
                                        </code>
                                    </section>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        <div className="p-8 bg-muted/10 rounded-[2.5rem] border border-border/50">
                                            <h4 className="text-foreground font-black mb-4 uppercase text-sm tracking-widest flex items-center gap-2">
                                                <span className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs">2</span>
                                                Auto Start
                                            </h4>
                                            <p className="text-xs text-muted-foreground leading-relaxed">
                                                กด <strong>Windows + R</strong> พิมพ์ <code>shell:startup</code> แล้วลาก Shortcut ไปวางในโฟลเดอร์นั้น เพื่อให้เครื่องเปิดแอปเองเมื่อไฟมา
                                            </p>
                                        </div>
                                        <div className="p-8 bg-destructive/5 rounded-[2.5rem] border border-destructive/20 outline outline-4 outline-transparent hover:outline-destructive/10 transition-all">
                                            <h4 className="text-destructive font-black mb-4 uppercase text-sm tracking-widest flex items-center gap-2">
                                                <span className="w-8 h-8 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center text-xs">!</span>
                                                Identity Warning
                                            </h4>
                                            <p className="text-xs text-destructive-foreground/70 leading-relaxed font-medium">
                                                ห้ามลบ History หรือใช้โหมด Incognito เพราะจะทำให้ <strong>Device ID</strong> หายไปจากระบบและต้องลงทะเบียนเครื่องใหม่
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <footer className="py-12 border-t border-border/50 mt-8">
                        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                            <p className="text-xs font-mono tracking-[0.4em] text-muted-foreground opacity-50 uppercase italic">
                                Rainbow Unicorn Standard • Integrated Signage Architecture
                            </p>
                            <div className="flex gap-4">
                                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                                <div className="w-2 h-2 rounded-full bg-accent-purple animate-pulse delay-75" />
                                <div className="w-2 h-2 rounded-full bg-accent-cyan animate-pulse delay-150" />
                            </div>
                        </div>
                    </footer>
                </main>
            </div>
        </div>
    );
}

'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { SYSTEM_VERSION } from '@/lib/constants';

export default function UserGuidePage() {
    const [activeSection, setActiveSection] = useState('overview');

    const sections = [
        { id: 'overview', title: 'ภาพรวมระบบ', icon: '🌈', desc: 'System overview' },
        { id: 'admin', title: 'การใช้งาน Admin', icon: '🛠️', desc: 'Admin console guide' },
        { id: 'player', title: 'โปรแกรม Player', icon: '🖥️', desc: 'Device setup & maintenance' },
        { id: 'setup', title: 'การติดตั้ง Player', icon: '⚙️', desc: 'Installation steps' },
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
                        <h1 className="text-4xl font-black tracking-tighter uppercase leading-none">
                            User <br />
                            <span className="text-primary">Guide</span>
                        </h1>
                        <p className="text-muted-foreground text-sm font-medium">Documentation and resources</p>
                    </div>

                    <nav className="space-y-1" aria-label="Guide sections">
                        {sections.map((s) => (
                            <button
                                type="button"
                                key={s.id}
                                onClick={() => setActiveSection(s.id)}
                                aria-current={activeSection === s.id ? 'page' : undefined}
                                className={`w-full group px-4 py-3 rounded-xl flex items-center gap-3 transition-colors text-left ${activeSection === s.id
                                    ? 'bg-primary text-primary-foreground'
                                    : 'hover:bg-muted text-muted-foreground hover:text-foreground border border-transparent'
                                    }`}
                            >
                                <span className={`text-xl transition-transform group-hover:scale-110 ${activeSection === s.id ? 'opacity-100' : 'opacity-60'}`} aria-hidden="true">
                                    {s.icon}
                                </span>
                                <div className="flex flex-col">
                                    <span className="text-sm font-bold leading-tight" lang="th">{s.title}</span>
                                    <span className={`text-xs font-medium uppercase tracking-wider ${activeSection === s.id ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                                        {s.desc}
                                    </span>
                                </div>
                            </button>
                        ))}
                    </nav>

                    <div className="pt-8 border-t border-border/50">
                        <Link
                            href="/admin/changelog"
                            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-accent-purple/10 border border-accent-purple/20 text-accent-purple text-xs font-black uppercase tracking-widest hover:bg-accent-purple/20 transition-colors"
                        >
                            <span aria-hidden="true">📝</span> Changelog
                        </Link>
                    </div>
                </aside>

                {/* --- Main Content Area --- */}
                <main className="flex-1 min-w-0">
                    <div className="bg-card-solid border border-border/50 rounded-[2.5rem] shadow-2xl p-8 lg:p-12 min-h-[800px] relative overflow-hidden">

                        {/* --- Page: Overview --- */}
                        {activeSection === 'overview' && (
                            <div className="space-y-12 animate-in">
                                <header className="space-y-4">
                                    <h2 className="text-5xl font-black text-foreground uppercase tracking-tighter">Signage <br /><span className="text-primary">Unicorn</span></h2>
                                    <p className="text-muted-foreground leading-relaxed text-lg max-w-2xl font-medium" lang="th">
                                        ระบบบริหารจัดการสื่อประชาสัมพันธ์ส่วนกลางที่เน้นความง่ายและความทนทาน ออกแบบมาเพื่อรองรับโครงข่ายขนาด 800+ สกรีน
                                    </p>
                                </header>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {quickSteps.map((step, i) => (
                                        <div key={i} className="p-6 bg-muted/20 rounded-2xl border border-border/40 hover:border-primary/30 transition-colors group" lang="th">
                                            <div className="text-primary font-bold text-xs mb-2 uppercase tracking-widest flex items-center gap-2">
                                                <div className="w-1.5 h-1.5 rounded-full bg-primary" aria-hidden="true" />
                                                {step.title.split('.')[1]}
                                            </div>
                                            <div className="text-sm text-muted-foreground leading-relaxed font-medium">{step.desc}</div>
                                        </div>
                                    ))}
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6">
                                    <div className="p-8 bg-accent-purple/5 rounded-[2rem] border border-accent-purple/15">
                                        <div className="text-4xl mb-6" aria-hidden="true">🏠</div>
                                        <h4 className="font-black text-foreground mb-2 uppercase text-xs tracking-widest">Admin console</h4>
                                        <p className="text-xs text-muted-foreground leading-relaxed font-medium" lang="th">Admin Dashboard สำหรับจัดการสื่อ, Playlist และสั่งการหน้าจอจากส่วนกลางผ่าน LAN/Cloud</p>
                                    </div>
                                    <div className="p-8 bg-primary/5 rounded-[2rem] border border-primary/15">
                                        <div className="text-4xl mb-6" aria-hidden="true">🔄</div>
                                        <h4 className="font-black text-foreground mb-2 uppercase text-xs tracking-widest">Smart sync</h4>
                                        <p className="text-xs text-muted-foreground leading-relaxed font-medium" lang="th">ดาวน์โหลดสื่อเฉพาะส่วนที่เปลี่ยนใหม่เพื่อความรวดเร็วและไม่ขัดจังหวะการเล่นปัจจุบัน</p>
                                    </div>
                                    <div className="p-8 bg-green-500/5 rounded-[2rem] border border-green-500/15">
                                        <div className="text-4xl mb-6" aria-hidden="true">🛡️</div>
                                        <h4 className="font-black text-foreground mb-2 uppercase text-xs tracking-widest">Offline play</h4>
                                        <p className="text-xs text-muted-foreground leading-relaxed font-medium" lang="th">ระบบที่ช่วยให้หน้าจอยังคงเล่นสื่อต่อไปได้ตลอด 24 ชม. แม้การเชื่อมต่ออินเทอร์เน็ตจะขัดข้อง</p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* --- Page: Admin --- */}
                        {activeSection === 'admin' && (
                            <div className="space-y-12 animate-in">
                                <header className="space-y-4">
                                    <h2 className="text-5xl font-black text-foreground uppercase tracking-tighter">Admin <span className="text-accent-cyan">console</span></h2>
                                    <p className="text-muted-foreground leading-relaxed text-lg max-w-2xl font-medium" lang="th">
                                        สำหรับผู้ดูแลระบบส่วนกลาง รองรับการบริหารจัดการสื่อ อุปกรณ์ และการกระจายข้อมูลแบบเรียลไทม์
                                    </p>
                                </header>

                                {/* Unified Network Config Box */}
                                <div className="p-8 bg-primary/5 rounded-[2rem] border border-primary/20 relative">
                                    <div className="flex justify-between items-center mb-6 gap-4 flex-wrap">
                                        <h4 className="text-primary font-black uppercase text-sm tracking-widest">Network configuration</h4>
                                        <span className="px-3 py-1 bg-primary/20 rounded-full text-xs font-black text-foreground">Automated</span>
                                    </div>
                                    <p className="text-muted-foreground text-sm leading-relaxed mb-6 font-medium" lang="th">
                                        เมื่อย้าย Server หรือเปลี่ยนพอร์ต สามารถแก้ไขได้ทันทีผ่าน <strong>Settings {'>'} System Config</strong> โดยระบบจะจัดการทรัพยากรเหล่านี้ให้อัตโนมัติ:
                                    </p>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div className="p-4 bg-muted/20 rounded-xl border border-border/50">
                                            <span className="block text-xs font-black text-foreground uppercase mb-1">API backend</span>
                                            <p className="text-xs text-muted-foreground" lang="th">แก้ไข <code>appsettings.json</code> ให้อัตโนมัติ</p>
                                        </div>
                                        <div className="p-4 bg-muted/20 rounded-xl border border-border/50">
                                            <span className="block text-xs font-black text-foreground uppercase mb-1">SQL migration</span>
                                            <p className="text-xs text-muted-foreground" lang="th">อัปเดต URL ของสื่อทุกชิ้นในฐานข้อมูล</p>
                                        </div>
                                        <div className="p-4 bg-muted/20 rounded-xl border border-border/50">
                                            <span className="block text-xs font-black text-foreground uppercase mb-1">Web environment</span>
                                            <p className="text-xs text-muted-foreground" lang="th">อัปเดตไฟล์ <code>.env</code> ของหน้า Dashboard</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    <div className="space-y-4">
                                        <h3 className="text-xl font-bold uppercase tracking-tight">Media lifecycle (v2.3)</h3>
                                        <ul className="space-y-4 text-sm text-muted-foreground" lang="th">
                                            <li className="flex gap-4">
                                                <span className="w-6 h-6 rounded-lg bg-accent-cyan/10 border border-accent-cyan/20 flex items-center justify-center text-accent-cyan text-xs font-bold shrink-0" aria-hidden="true">01</span>
                                                <p><strong className="text-foreground">Upload &amp; Expiry:</strong> ระบุ <strong>End Date</strong> (Optional) เมื่ออัปโหลด สื่อจะถูกระงับการใช้งานอัตโนมัติเมื่อถึงกำหนด</p>
                                            </li>
                                            <li className="flex gap-4">
                                                <span className="w-6 h-6 rounded-lg bg-accent-cyan/10 border border-accent-cyan/20 flex items-center justify-center text-accent-cyan text-xs font-bold shrink-0" aria-hidden="true">02</span>
                                                <p><strong className="text-foreground">Status Logic:</strong> ‘Active’ คือพร้อมใช้งาน, ‘Inactive’ คือหมดอายุหรือถูกลบ (Soft Delete) สามารถ <strong>Restore</strong> กลับมาได้</p>
                                            </li>
                                            <li className="flex gap-4">
                                                <span className="w-6 h-6 rounded-lg bg-accent-cyan/10 border border-accent-cyan/20 flex items-center justify-center text-accent-cyan text-xs font-bold shrink-0" aria-hidden="true">03</span>
                                                <p><strong className="text-foreground">Auto-Cleanup:</strong> Background Worker จะตรวจสอบสื่อหมดอายุทุก 6 ชม. หรือสั่ง <strong>&quot;Check Expiry&quot;</strong> ได้ทันทีจาก Toolbar</p>
                                            </li>
                                        </ul>
                                    </div>

                                    <div className="space-y-4">
                                        <h3 className="text-xl font-bold uppercase tracking-tight">Glossary</h3>
                                        <div className="grid grid-cols-2 gap-3">
                                            {[
                                                { k: 'Screen', v: 'หน้าจอปลายทาง' },
                                                { k: 'Media', v: 'ไฟล์สื่อในระบบ' },
                                                { k: 'PoP', v: 'Proof of Play' },
                                                { k: 'Sync', v: 'การประสานข้อมูล' }
                                            ].map((item, i) => (
                                                <div key={i} className="p-3 bg-muted/10 rounded-xl border border-border/50">
                                                    <span className="block text-xs font-black text-foreground uppercase">{item.k}</span>
                                                    <span className="text-xs text-muted-foreground font-medium" lang="th">{item.v}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* --- Page: Player --- */}
                        {activeSection === 'player' && (
                            <div className="space-y-12 animate-in">
                                <header className="space-y-4">
                                    <h2 className="text-5xl font-black text-foreground uppercase tracking-tighter">Player <span className="text-accent-purple">client</span></h2>
                                    <p className="text-muted-foreground leading-relaxed text-lg max-w-2xl font-medium" lang="th">
                                        เจาะลึกการทำงานของแอปพลิเคชันปลายทาง (Player) และการบำรุงรักษาโดยช่างเทคนิค
                                    </p>
                                </header>

                                {/* Technical Callout */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="p-6 bg-accent-purple/5 rounded-3xl border border-accent-purple/20 space-y-4">
                                        <h4 className="text-accent-purple font-black text-xs uppercase tracking-widest flex items-center gap-2">
                                            <span>SQLite engine &amp; robust sync</span>
                                        </h4>
                                        <p className="text-xs text-muted-foreground leading-relaxed font-medium" lang="th">
                                            เวอร์ชัน 2.0+ ใช้ <strong>Native SQLite</strong> ในการจัดการ Playlist และ Log (รองรับ 100k+ records) พร้อมระบบ <strong>Priority Queue</strong> ดาวน์โหลดสื่ออย่างมีลำดับและ <strong>Background Swap</strong> เปลี่ยนสื่อเมื่อพร้อมเท่านั้น
                                        </p>
                                    </div>
                                    <div className="p-6 bg-primary/5 rounded-3xl border border-primary/20 space-y-4">
                                        <h4 className="text-primary font-black text-xs uppercase tracking-widest flex items-center gap-2">
                                            <span>Proof of play (PoP)</span>
                                        </h4>
                                        <p className="text-xs text-muted-foreground leading-relaxed font-medium" lang="th">
                                            ทุกครั้งที่คลิปเล่นจบ เครื่องจะบันทึก Log ลงใน <strong>Local Queue</strong> และจะ Sync ไปยัง Server ทุกๆ 15 วินาที หรือเมื่อมีอินเทอร์เน็ต
                                        </p>
                                    </div>
                                </div>

                                {/* Hotkeys Table */}
                                <div className="space-y-6">
                                    <h3 className="text-2xl font-black uppercase tracking-tight border-l-4 border-accent-purple pl-6">Maintenance hotkeys</h3>
                                    <div className="overflow-x-auto rounded-2xl border border-border/50 bg-muted/10">
                                        <table className="w-full text-sm text-left">
                                            <thead className="bg-muted text-xs font-black uppercase tracking-widest">
                                                <tr>
                                                    <th scope="col" className="px-6 py-4">Key</th>
                                                    <th scope="col" className="px-6 py-4">Action</th>
                                                    <th scope="col" className="px-6 py-4">Description</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border/50">
                                                {[
                                                    { k: 'F1', a: 'Help', d: 'แสดงเมนูช่วยเหลือ (HUD)' },
                                                    { k: 'F5', a: 'Restart', d: 'โหลดแอปใหม่กรณีหน้าจอค้าง' },
                                                    { k: 'F6', a: 'Force Sync', d: 'บังคับตรวจสอบ Playlist ทันที' },
                                                    { k: 'F7', a: 'Dashboard', d: 'เปิดหน้าจอวินิจฉัยสำหรับช่างเทคนิค' },
                                                    { k: 'F8', a: 'Reset Loop', d: 'เริ่มเล่นคลิปแรกสุดของรายการ' }
                                                ].map((row, i) => (
                                                    <tr key={i} className="hover:bg-muted/30 transition-colors">
                                                        <td className="px-6 py-4 font-black text-accent-purple">{row.k}</td>
                                                        <td className="px-6 py-4 font-bold text-foreground">{row.a}</td>
                                                        <td className="px-6 py-4 text-muted-foreground font-medium" lang="th">{row.d}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                {/* Troubleshooting Section */}
                                <div className="p-8 bg-muted/20 rounded-[2.5rem] border border-border/50">
                                    <h3 className="text-xl font-black uppercase tracking-tight mb-6 flex items-center gap-3">
                                        <span className="text-yellow-500" aria-hidden="true">⚠️</span> Basic troubleshooting
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8" lang="th">
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
                            <div className="space-y-12 animate-in">
                                <header className="space-y-4">
                                    <h2 className="text-5xl font-black text-foreground uppercase tracking-tighter">Device <span className="text-green-600 dark:text-green-400">installation</span></h2>
                                    <p className="text-muted-foreground leading-relaxed text-lg max-w-2xl font-medium" lang="th">
                                        ขั้นตอนการติดตั้งเครื่องชิ้นแรกและการตั้งค่า Kiosk Mode สำหรับ Windows
                                    </p>
                                </header>

                                <div className="space-y-8">
                                    <section className="p-8 bg-muted/10 rounded-[2.5rem] border border-border/50">
                                        <h4 className="text-foreground font-black mb-4 uppercase text-sm tracking-widest flex items-center gap-2">
                                            <span className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs" aria-hidden="true">1</span>
                                            Chrome kiosk setup
                                        </h4>
                                        <p className="text-muted-foreground text-sm mb-6 leading-relaxed" lang="th">สร้าง Shortcut ของ Google Chrome แล้วเติม Parameter ในช่อง <strong>Target</strong>:</p>
                                        <code className="block bg-black p-6 rounded-2xl border border-border/20 text-green-400 font-mono text-xs select-all leading-relaxed whitespace-pre-wrap">
                                            --kiosk http://YOUR_SERVER_IP:8865/player --autoplay-policy=no-user-gesture-required --disk-cache-size=1073741824 --disable-infobars --no-first-run
                                        </code>
                                    </section>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        <div className="p-8 bg-muted/10 rounded-[2.5rem] border border-border/50">
                                            <h4 className="text-foreground font-black mb-4 uppercase text-sm tracking-widest flex items-center gap-2">
                                                <span className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs" aria-hidden="true">2</span>
                                                Auto start
                                            </h4>
                                            <p className="text-xs text-muted-foreground leading-relaxed" lang="th">
                                                กด <strong>Windows + R</strong> พิมพ์ <code>shell:startup</code> แล้วลาก Shortcut ไปวางในโฟลเดอร์นั้น เพื่อให้เครื่องเปิดแอปเองเมื่อไฟมา
                                            </p>
                                        </div>
                                        <div className="p-8 bg-destructive/5 rounded-[2.5rem] border border-destructive/30">
                                            <h4 className="text-red-600 dark:text-red-400 font-black mb-4 uppercase text-sm tracking-widest flex items-center gap-2">
                                                <span className="w-8 h-8 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center text-xs" aria-hidden="true">!</span>
                                                Identity warning
                                            </h4>
                                            <p className="text-xs text-foreground/80 leading-relaxed font-medium" lang="th">
                                                ห้ามลบ History หรือใช้โหมด Incognito เพราะจะทำให้ <strong>Device ID</strong> หายไปจากระบบและต้องลงทะเบียนเครื่องใหม่
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <footer className="py-12 border-t border-border/50 mt-8">
                        <p className="text-xs font-mono tracking-[0.2em] text-muted-foreground uppercase">
                            Signage Unicorn documentation · v{SYSTEM_VERSION}
                        </p>
                    </footer>
                </main>
            </div>
        </div>
    );
}

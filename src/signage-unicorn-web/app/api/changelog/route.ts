import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
    try {
        const changelogPath = path.join(process.cwd(), '..', '..', 'docs', 'CHANGELOG.md');

        // Check if file exists
        if (!fs.existsSync(changelogPath)) {
            return NextResponse.json({ success: false, message: 'Changelog not found' }, { status: 404 });
        }

        const content = fs.readFileSync(changelogPath, 'utf8');
        return NextResponse.json({ success: true, content });
    } catch (error: any) {
        return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    }
}

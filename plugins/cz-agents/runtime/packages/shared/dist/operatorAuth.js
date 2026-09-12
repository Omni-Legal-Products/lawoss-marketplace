import { createHash, timingSafeEqual } from 'node:crypto';
/** Independent operator boundary; existing billing Authorization is unchanged. */
export function createOperatorAuth(secret = process.env.LAWOSS_ACCESS_TOKEN) {
    if (!secret || secret.length < 32 || /\s/.test(secret)) {
        throw new Error('Set LAWOSS_ACCESS_TOKEN to a private random token of at least 32 characters before starting HTTP.');
    }
    const expected = createHash('sha256').update(secret).digest();
    return (req, res) => {
        const supplied = req.headers['x-lawoss-token'];
        const valid = typeof supplied === 'string' && supplied.length <= 4096 &&
            timingSafeEqual(expected, createHash('sha256').update(supplied).digest());
        if (valid)
            return true;
        res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'operator_auth_required' }));
        return false;
    };
}
//# sourceMappingURL=operatorAuth.js.map
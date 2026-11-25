import json, numpy as np, sys
R='/home/claude/mrun/'
m=json.load(open('/tmp/gm_model.json')); r=json.load(open('/tmp/gm_result.json'))
bars=np.array(m['bars'])+1; mb=np.loadtxt(R+'gm_bars.txt').astype(int)
print('bars equal', bars.shape, mb.shape, np.array_equal(bars,mb))
X=np.array(m['nodes']); mX=np.loadtxt(R+'gm_node.txt'); print('nodes maxdiff', np.abs(X-mX).max())
A=np.array(m['A']); mA=np.loadtxt(R+'gm_A.txt'); print('A rel', np.abs(A-mA).max()/mA.max())
H=m['hinges']; nb=m['nBend']
kb=np.array([h['kp'] for h in H[:nb]]); kf=np.array([h['kp'] for h in H[nb:nb+m['nFold']]])
print('kb rel', np.abs(kb-np.loadtxt(R+'gm_kb.txt')).max()/kb.max(), 'kf rel', np.abs(kf-np.loadtxt(R+'gm_kf.txt')).max()/kf.max())
fo=np.array([h['n'] for h in H[nb:nb+m['nFold']]])+1; print('fold equal', np.array_equal(fo, np.loadtxt(R+'gm_fold.txt').astype(int)))
be=np.array([h['n'] for h in H[:nb]])+1; print('bend equal', np.array_equal(be, np.loadtxt(R+'gm_bend.txt').astype(int)))
nd=r['nd']; st=r['stride']; fr=np.fromfile('/tmp/gm_frames.bin').reshape(-1,st)
U=fr[1:,:nd].T; IF=fr[1:,nd:2*nd].T
mU=np.loadtxt(R+'gm_U.txt'); print('U shape', U.shape, mU.shape, 'max abs diff', np.abs(U-mU).max(), 'scale', np.abs(mU).max())
mF=np.loadtxt(R+'gm_F.txt'); F=-IF[3*58+1]
print('F max abs diff', np.abs(F-mF).max(), 'Fmax', mF.max())
mE=np.loadtxt(R+'gm_E.txt')
for k,i in (('PE',0),('US',1),('UF',2),('UB',3)):
    v=np.array(r['US'][1:])+np.array(r['UF'][1:])+np.array(r['UB'][1:]) if k=='PE' else np.array(r[k][1:])
    print(k,'max abs diff', np.abs(v-mE[i]).max(), 'max', mE[i].max())

def read_obj(path):
    V, F = [], []
    for ln in open(path):
        p = ln.split()
        if not p: continue
        if p[0] == 'v': V.append([float(x) for x in p[1:4]])
        elif p[0] == 'f': F.append([int(t.split('/')[0]) - 1 for t in p[1:]])
    return V, F

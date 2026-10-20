# 去掉卡面烘焙文字：在 rects.json 指定的文字区内，用局部对比检测笔画 → 膨胀 → OpenCV 修补 → 羽化柔化。
import cv2, json, numpy as np, sys, os
R = json.load(open(os.path.join(os.path.dirname(__file__), 'rects.json')))
def detext(src, key, out, dbg=None):
    im = cv2.imread(src); H, W = im.shape[:2]; mask = np.zeros((H, W), np.uint8); soft = np.zeros((H, W), np.float32)
    g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).astype(np.float32); k = max(15, (W // 30) | 1)
    med = cv2.medianBlur(g.astype(np.uint8), k).astype(np.float32); diff = np.abs(g - med)
    for x0, y0, x1, y1 in R[key]:
        a, b, c, d = int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H)
        m = (diff[b:d, a:c] > 18).astype(np.uint8) * 255
        m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (max(5, W // 120) | 1,) * 2))
        mask[b:d, a:c] = np.maximum(mask[b:d, a:c], m); soft[b:d, a:c] = 1
    res = cv2.inpaint(im, mask, max(5, W // 100), cv2.INPAINT_TELEA)
    bl = cv2.GaussianBlur(res, (0, 0), W / 90)  # 柔化修补痕迹（只在文字区内，边缘羽化）
    sf = cv2.GaussianBlur(soft, (0, 0), W / 60)[..., None] * .85
    out_im = (res * (1 - sf) + bl * sf).astype(np.uint8)
    cv2.imwrite(out, out_im)
    if dbg: cv2.imwrite(dbg, mask)
if __name__ == '__main__': detext(*sys.argv[1:4], *(sys.argv[4:5] or [None]))

# T-0006 · 过程文档（notes.md）

## 2026-09-13

完成：① 帧泵归驱动（frame/loop.ts 的 audio 档，每完整帧一次、先于合成；report 显式 never）；② HeadlessScene.audio = 真 AudioEngine（条件能力：给 audioHost 才存在，否则闸门 A 记缺口）；③ 新增 NodeAudioHost（FileSource 真字节 + 容器头推时长：OGG 末页 granule/采样率、WAV data/byteRate；不出声；无流式）；④ 修 armedAtMs 的 0 哨兵（headless 虚拟时钟第一帧为 0 ⇒ 延迟晚一帧；实测 SE004=0.358s/FIA3203=3.307s/BGM031=134.489s）；⑤ 两条 chain 新增 audioEvents[] + audio 开关；before/after：gameStart drops audio×37→0、events 0→14；config1 14→0、0→6。判据：npm test 454/454；report sha256 FBC05509… 不变；E4 postT6 [audio] 24 行。

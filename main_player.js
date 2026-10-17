// panel.js — JScript Panel dla foobar2000 by Spazma
// Funkcje: historia prev/next, fade overlay, ARTIST anim (slide + czarne glow), shortened path
// Dodano: tooltipy (path full, RG values, prev/next lists, prog time, star hint, artist info)

var ww = 0, wh = 0;

var fontArtist = gdi.Font("Segoe UI", 18, 1);
var fontTitle  = gdi.Font("Segoe UI", 24, 1);
var fontRating = gdi.Font("Segoe UI", 18, 1);
var fontInfo   = gdi.Font("Segoe UI", 13, 1);
var fontSmall  = gdi.Font("Segoe UI", 12, 1);
var fontPath   = gdi.Font("Courier New", 11, 0);

var hoverPath = false;
var hoverProg = false;

var starRects = [];
var hoverStar = 0;

var colBg      = 0xFF000000;
var colText    = 0xFFFFFFFF;
var colSub     = 0xFFC8C8C8;
var colYear    = 0xFFB4B4B4;
var colRating  = 0xFFFFD700;
var colInfo    = 0xFFDCDCDC;
var colWarn    = 0xFFFF5050;
var colTime    = 0xFFFFFF00;

var colProgBg  = 0xFF303030;
var colProg1   = 0xFF00A8FF;

var pathRect = null;
var rgRect = null;
var lastProgY = 0;

var animTick = 0;
var animTimer = null;

var isStopped = false;
var stopFade = 0; // 0–255
var stopPulse = 0;
var stopPulseDir = 1;

// NOWE: recty i stany dla prev/next
var prevRect = null;
var nextRect = null;
var hoverPrev = false;
var hoverNext = false;

// HISTORIA
var history = []; // stos cofnięć (starsze utwory po lewej, ostatni na końcu)
var future = [];  // stos do przodu (ostatni na końcu)
var currentTrack = null;
var HISTORY_LIMIT = 200;

// FADE przy zmianie utworu (overlay, nie związany z RG)
var trackFade = 0;
var FADE_STEP = 25;

// ARTIST ANIM (slide-in + glow)
var artistAnim = 0;
var ARTIST_ANIM_START = 255;
var ARTIST_ANIM_STEP = 40;
var ARTIST_SLIDE_MAX = 40;
var ARTIST_GLOW_MAX = 140;
var artistRectGlobal = null; // globalne rect dla artist (do tooltipu)

// RG FADE-IN (zachowana z poprzedniej wersji — tu rgAlpha kontroluje pojawianie RG)
var rgWaiting = false;
var rgWaitStart = 0;
var RG_WAIT_MAX = 1500; // ms
var rgAlpha = 255;      // start 255 (jeśli w połowie utworu), resetowane w startRgWait()
var RG_FADE_STEP = 25;

// TOOLTIP
var tooltipTimer = null;
var tooltipVisible = false;
var tooltipText = "";
var tooltipX = 0, tooltipY = 0;
var tooltipDelay = 600; // ms
var tooltipTarget = null;
var lastMouseX = 0, lastMouseY = 0;

function startAnim() {
    animTick++;

    if (isStopped && stopFade < 255) stopFade += 15;
    if (!isStopped && stopFade > 0)  stopFade -= 15;

    stopPulse += stopPulseDir * 8;
    if (stopPulse > 80) { stopPulse = 80; stopPulseDir = -1; }
    if (stopPulse < 0)  { stopPulse = 0;  stopPulseDir = 1; }

    if (trackFade > 0) {
        trackFade -= FADE_STEP;
        if (trackFade < 0) trackFade = 0;
    }

    if (artistAnim > 0) {
        artistAnim -= ARTIST_ANIM_STEP;
        if (artistAnim < 0) artistAnim = 0;
    }

    // RG loading / fade-in handling (if rgWaiting, hold rgAlpha at 0 until data or timeout)
    if (rgWaiting) {
        var g = tf("%replaygain_track_gain%");
        var p = tf("%replaygain_track_peak%");
        var now = Date.now();
        if ((g && g.length) || (p && p.length) || (now - rgWaitStart > RG_WAIT_MAX)) {
            rgWaiting = false;
        }
    } else {
        if (rgAlpha < 255) {
            rgAlpha += RG_FADE_STEP;
            if (rgAlpha > 255) rgAlpha = 255;
        }
    }

    window.Repaint();
    animTimer = window.SetTimeout(startAnim, 50);
}

startAnim();


// HELPERY
function tf(s) {
    var m = fb.GetNowPlaying();
    return m ? fb.TitleFormat(s).EvalWithMetadb(m) : "";
}

function tfInt(s) {
    var v = tf(s);
    var n = parseInt(v, 10);
    return isNaN(n) ? 0 : n;
}

function formatHandleShort(m) {
    try {
        return fb.TitleFormat("%artist% - %title%").EvalWithMetadb(m);
    } catch (e) {
        try { return m.Path; } catch (e2) { return "(unknown)"; }
    }
}

function drawCentered(gr, text, font, color, y) {
    if (!text) return y;
    var w = gr.CalcTextWidth(text, font);
    var h = font.Height;
    var x = (ww - w) / 2;
    gr.GdiDrawText(text, font, color, x, y, w, h, 0);
    return y + h;
}

function drawSpotifyProgress(gr, x, y, w, h, pos, len) {
    var bg = hoverProg ? 0xFF505050 : colProgBg;
    var pulse = 0x20 + Math.floor((Math.sin(animTick / 10) + 1) * 40);
    var base = colProg1 & 0x00FFFFFF;
    var fg = hoverProg ? 0xFF40C0FF : ((0xFF << 24) | base);

    gr.FillSolidRect(x, y + h / 2 - 1, w, 2, bg);

    if (len > 0 && pos > 0) {
        var frac = Math.min(1, pos / len);
        var fw = Math.floor(w * frac);

        gr.FillEllipse(x, y, h, h, fg);

        if (fw > h) {
            gr.FillEllipse(x + fw - h, y, h, h, fg);
        }

        var barX = x + h / 2;
        var barW = fw - h;
        if (barW > 0) {
            gr.FillSolidRect(barX, y + h / 2 - 1, barW, 2, fg);
        }
    }
}

// SHORTEN PATH HELPER
function shortenPath(gr, text, font, maxW) {
    if (!text) return "";
    if (gr.CalcTextWidth(text, font) <= maxW) return text;

    var filename = text.replace(/^.*[\\\/]/, '');
    var parent = text.substring(0, text.length - filename.length);

    if (gr.CalcTextWidth(filename, font) > maxW) {
        var keep = filename.length;
        while (keep > 1) {
            var cand = '...' + filename.substring(filename.length - keep);
            if (gr.CalcTextWidth(cand, font) <= maxW) return cand;
            keep--;
        }
        return '...' + filename.substring(filename.length - 1);
    }

    var sep = (parent && parent.charAt(parent.length - 1) !== '\\' && parent.charAt(parent.length - 1) !== '/') ? '\\' : '';
    var display = parent + sep + filename;
    if (gr.CalcTextWidth(display, font) <= maxW) return display;

    var keepParent = parent.length;
    while (keepParent > 0) {
        var p = '...' + parent.substring(parent.length - keepParent);
        display = p + sep + filename;
        if (gr.CalcTextWidth(display, font) <= maxW) return display;
        keepParent--;
    }

    return '...' + filename;
}

// TOOLTIP helpers
function clearTooltipTimer() {
    if (tooltipTimer) { window.ClearTimeout(tooltipTimer); tooltipTimer = null; }
}

function scheduleTooltip(text, x, y, target) {
    clearTooltipTimer();
    tooltipTarget = target;
    tooltipX = x + 12;
    tooltipY = y + 18;
    tooltipText = text;
    tooltipVisible = false;
    tooltipTimer = window.SetTimeout(function() {
        tooltipTimer = null;
        tooltipVisible = true;
        window.Repaint();
    }, tooltipDelay);
}

function hideTooltip() {
    clearTooltipTimer();
    if (tooltipVisible) {
        tooltipVisible = false;
        window.Repaint();
    }
    tooltipTarget = null;
}


// HISTORIA / PLAY
function sameTrack(a, b) {
    if (!a || !b) return false;
    try {
        return a.Compare(b) === 0;
    } catch (e) {
        try {
            return a.RawPath === b.RawPath;
        } catch (e2) {
            return false;
        }
    }
}

function pushCurrentTrack() {
    var m = fb.GetNowPlaying();
    if (!m) return;

    if (!currentTrack) {
        currentTrack = m;
        return;
    }

    if (!sameTrack(currentTrack, m)) {
        history.push(currentTrack);
        if (history.length > HISTORY_LIMIT) history.shift();
        future = [];
        currentTrack = m;
    }
}

function playTrack(handle) {
    if (!handle) return;
    try {
        fb.RunContextCommandWithMetadb("Play", handle);
    } catch (e) {
        try {
            if (typeof fb.PlayOrActivatePlaylistItem === "function") {
                fb.PlayOrActivatePlaylistItem(handle);
            } else if (typeof fb.Playlist === "object") {
                try {
                    var pl_idx = fb.ActivePlaylist;
                    var new_idx = fb.AddToPlaylist(pl_idx, handle);
                    if (typeof fb.PlaylistItemPlayback === "function") {
                        fb.PlaylistItemPlayback(pl_idx, new_idx);
                    }
                } catch(e2) {}
            }
        } catch (e2) {
            try { fb.RunMainMenuCommand("Playback/Next"); } catch(e3) {}
        }
    }
}

function startRgWait() {
    rgWaiting = true;
    rgWaitStart = Date.now();
    rgAlpha = 0; // reset alpha so RG will fade-in when ready (or when timeout reached)
}

function doPrev() {
    hideTooltip();
    if (!history.length) {
        try { fb.RunMainMenuCommand("Playback/Previous"); } catch (e) {}
        trackFade = 255;
        artistAnim = ARTIST_ANIM_START;
        startRgWait();
        return;
    }

    var prev = history.pop();
    if (currentTrack) future.push(currentTrack);
    if (future.length > HISTORY_LIMIT) future.shift();

    currentTrack = prev;
    trackFade = 255;
    artistAnim = ARTIST_ANIM_START;
    startRgWait();
    playTrack(prev);
    window.Repaint();
}

function doNext() {
    hideTooltip();
    if (!future.length) {
        try { fb.RunMainMenuCommand("Playback/Next"); } catch (e) {}
        trackFade = 255;
        artistAnim = ARTIST_ANIM_START;
        startRgWait();
        return;
    }

    var nxt = future.pop();
    if (currentTrack) history.push(currentTrack);
    if (history.length > HISTORY_LIMIT) history.shift();

    currentTrack = nxt;
    trackFade = 255;
    artistAnim = ARTIST_ANIM_START;
    startRgWait();
    playTrack(nxt);
    window.Repaint();
}


// RYSOWANIE
function on_paint(gr) {
    gr.FillSolidRect(0, 0, ww, wh, colBg);

    if (stopFade > 0) {
        var fadeCol = (stopFade << 24) | 0x000000;
        gr.FillSolidRect(0, 0, ww, wh, fadeCol);

        var msg = "Stopped";
        var w = gr.CalcTextWidth(msg, fontTitle);
        var h = fontTitle.Height;
        var x = (ww - w) / 2;
        var y = (wh - h) / 2 - 40;

        gr.GdiDrawText(msg, fontTitle, 0x80FFFFFF, x, y, w, h, 0);

        var size = 40 + stopPulse / 4;
        var sx = (ww - size) / 2;
        var sy = y + h + 40;

        var alpha = 120 + stopPulse;
        var col = (alpha << 24) | 0xFFFFFF;

        gr.FillSolidRect(sx, sy, size, size, col);

        if (stopFade > 40) return;
    }

    var artist = tf("%artist%");
    var title  = tf("%title%");
    var album  = tf("%album%");
    var year   = tf("$left(%date%,4)");
    var rating = tfInt("%rating%");
    var playCount = tf("%play_count%");
    var bitrate   = tf("%bitrate%");
    var samplerate = tf("%samplerate%");
    var filesize  = tf("%filesize_natural%");
    var channels  = tf("%channels%");
    var codec     = tf("%codec%");
    var gain      = tf("%replaygain_track_gain%");
    var peak      = tf("%replaygain_track_peak%");
    var path      = tf("%path%");
    var isPlaying = fb.IsPlaying;
    var isPaused  = fb.IsPaused;

    var y = 20;

    // ARTIST (slide-in + black glow) -- left-aligned to title
    var artistRect = null;
    if (artist) {
        // zmierz szerokość tytułu aby przypiąć artystę do jego lewej krawędzi
        var titleW = title ? gr.CalcTextWidth(title, fontTitle) : 0;
        var titleX = Math.floor((ww - titleW) / 2);

        var text = "> " + artist + " <";
        var w = gr.CalcTextWidth(text, fontArtist);
        var h = fontArtist.Height;

        // baseX: ustawienie lewej krawędzi artysty na lewą krawędź tytułu
        // jeśli nie ma tytułu (titleW==0) wróć do centrowania
        var baseX;
        if (titleW > 0) {
            baseX = titleX;
            // zabezpieczenie: jeśli artysta wychodzi poza prawą krawędź okna, przesuwamy go tak, żeby był widoczny
            if (baseX + w > ww) baseX = Math.max(0, ww - w);
        } else {
            baseX = Math.floor((ww - w) / 2);
        }

        var ay = y;
        var offset = Math.floor((artistAnim / ARTIST_ANIM_START) * ARTIST_SLIDE_MAX);
        var x = baseX - offset;

        var glowAlpha = Math.floor((artistAnim / ARTIST_ANIM_START) * ARTIST_GLOW_MAX);
        if (glowAlpha > 0) {
            var glowCol = (glowAlpha << 24) | 0x000000;
            gr.GdiDrawText(text, fontArtist, glowCol, x - 1, ay, w, h, 0);
            gr.GdiDrawText(text, fontArtist, glowCol, x + 1, ay, w, h, 0);
            gr.GdiDrawText(text, fontArtist, glowCol, x, ay - 1, w, h, 0);
            gr.GdiDrawText(text, fontArtist, glowCol, x, ay + 1, w, h, 0);
        }

        var pulse = Math.floor((Math.sin(animTick / 8) + 1) * 20);
        var baseColorRGB = colText & 0x00FFFFFF;
        function blendWithWhite(rgb, amount) {
            var r = (rgb >> 16) & 0xFF;
            var g = (rgb >> 8) & 0xFF;
            var b = rgb & 0xFF;
            r = Math.min(255, Math.floor(r + (255 - r) * amount / 100));
            g = Math.min(255, Math.floor(g + (255 - g) * amount / 100));
            b = Math.min(255, Math.floor(b + (255 - b) * amount / 100));
            return (r << 16) | (g << 8) | b;
        }
        var brightRGB = blendWithWhite(baseColorRGB, pulse);
        var mainCol = (0xFF << 24) | brightRGB;

        gr.GdiDrawText(text, fontArtist, mainCol, x, ay, w, h, 0);

        artistRect = { x: baseX, y: ay, w: w, h: h, text: artist };
        artistRectGlobal = artistRect; // expose for tooltip
        y += h;
    } else {
        artistRectGlobal = null;
    }

    if (title)  y = drawCentered(gr, title, fontTitle, colText, y + 5);

    // RATING stars
    var starY = y + 5;
    var starSize = fontRating.Height;
    var totalWidth = starSize * 5;
    var startX = (ww - totalWidth) / 2;

    starRects = [];

    for (var i = 1; i <= 5; i++) {
        var sx = startX + (i - 1) * starSize;
        var isFilled = (i <= rating);
        var isHover = (i <= hoverStar);

        var scol = isHover ? 0xFFFFFF00 : (isFilled ? colRating : colSub);
        var char = isFilled ? "★" : "☆";

        gr.GdiDrawText(char, fontRating, scol, sx, starY, starSize, starSize, 0);

        starRects.push({ x: sx, y: starY, w: starSize, h: starSize, value: i });
    }

    y = starY + starSize;

    var albumLine = "";
    if (album) albumLine += "Album: " + album;
    if (year)  albumLine += (album ? "  " : "") + "Year: " + year;
    if (albumLine) y = drawCentered(gr, albumLine, fontInfo, colSub, y + 5);

    y += 15;

    // play count + prev/next (lowercase)
    var status = isPlaying ? (isPaused ? "⏸" : "▶") : "■";
    var pcText = (playCount ? playCount : "") + "  " + status;

    var prevText = "prev";
    var sepText = " | ";
    var nextText = "next";

    var pcW = gr.CalcTextWidth(pcText, fontSmall);
    var prevW = gr.CalcTextWidth(prevText, fontSmall);
    var sepW = gr.CalcTextWidth(sepText, fontSmall);
    var nextW = gr.CalcTextWidth(nextText, fontSmall);

    var gap = 12;
    var totalW = pcW + gap + prevW + sepW + nextW;
    var startXLinks = Math.floor((ww - totalW) / 2);

    var pcH = fontSmall.Height;
    gr.GdiDrawText(pcText, fontSmall, colSub, startXLinks, y, pcW, pcH, 0);

    var lx = startXLinks + pcW + gap;

    var pcol = hoverPrev ? 0xFFFFFFFF : colSub;
    gr.GdiDrawText(prevText, fontSmall, pcol, lx, y, prevW, pcH, 0);
    if (hoverPrev) gr.FillSolidRect(lx, y + pcH - 2, prevW, 1, 0xFFFFFFFF);
    prevRect = { x: lx, y: y, w: prevW, h: pcH };

    lx += prevW;
    gr.GdiDrawText(sepText, fontSmall, colSub, lx, y, sepW, pcH, 0);
    lx += sepW;

    var ncol = hoverNext ? 0xFFFFFFFF : colSub;
    gr.GdiDrawText(nextText, fontSmall, ncol, lx, y, nextW, pcH, 0);
    if (hoverNext) gr.FillSolidRect(lx, y + pcH - 2, nextW, 1, 0xFFFFFFFF);
    nextRect = { x: lx, y: y, w: nextW, h: pcH };

    y += pcH;
    y += 10;

    var progWidth = Math.floor(ww * 0.7);
    var progX = Math.floor((ww - progWidth) / 2);
    var progH = 10;
    var progY = y;

    drawSpotifyProgress(gr, progX, progY, progWidth, progH, fb.PlaybackTime, fb.PlaybackLength);
    lastProgY = progY;

    y = progY + progH + 12;

    var timeText = "";
    if (fb.PlaybackLength > 0) {
        timeText = fb.TitleFormat("%playback_time%").Eval() + " / " +
                   fb.TitleFormat("%length%").Eval();
    }
    y = drawCentered(gr, timeText, fontSmall, colTime, y);

    y += 15;

    var infoLine = "";
    if (bitrate)    infoLine += "bitrate: " + bitrate + " | ";
    if (samplerate) infoLine += "samplerate: " + samplerate + " | ";
    if (filesize)   infoLine += filesize + " | ";
    if (channels)   infoLine += channels + " | ";
    if (codec)      infoLine += codec;

    if (infoLine) y = drawCentered(gr, infoLine, fontInfo, colInfo, y);

    y += 10;

    // RG rendering + set rgRect & tooltip text (use rgAlpha for fade-in)
    rgRect = null;
    var rgTooltip = "";
    var haveGain = (gain && gain.length);
    var havePeak = (peak && peak.length);

    if (rgAlpha > 0) {
        if (haveGain || havePeak) {
            var rgText = "";
            if (haveGain) rgText += "Gain: " + gain;
            if (havePeak) {
                var p = parseFloat(peak);
                var pct = isNaN(p) ? "" : Math.round(p * 100) + "%";
                if (rgText) rgText += "  |  ";
                if (!isNaN(p) && p > 1) rgText += "WARNING! Peak > 1.0: " + pct;
                else if (pct) rgText += "Peak: " + pct;
                rgTooltip = "Gain: " + (gain || "n/a") + "\nPeak: " + (peak || "n/a") + (isNaN(p) ? "" : " (" + pct + ")");
            } else {
                rgTooltip = "Gain: " + (gain || "n/a");
            }

            var beforeY = y;
            var a = Math.max(0, Math.min(255, Math.floor(rgAlpha)));
            var col = ((a & 0xFF) << 24) | (colText & 0x00FFFFFF);
            y = drawCentered(gr, rgText, fontInfo, col, y);
            var w = gr.CalcTextWidth(rgText, fontInfo);
            var h = fontInfo.Height;
            var rx = Math.floor((ww - w) / 2);
            rgRect = { x: rx, y: beforeY, w: w, h: h, tooltip: rgTooltip };
        } else {
            var textNo = "No ReplayGain!";
            var a2 = Math.max(0, Math.min(255, Math.floor(rgAlpha)));
            var col2 = ((a2 & 0xFF) << 24) | (colWarn & 0x00FFFFFF);
            var beforeY2 = y;
            var w2 = gr.CalcTextWidth(textNo, fontInfo);
            gr.GdiDrawText(textNo, fontInfo, col2, Math.floor((ww - w2) / 2), beforeY2, w2, fontInfo.Height, 0);
            rgRect = { x: Math.floor((ww - w2) / 2), y: beforeY2, w: w2, h: fontInfo.Height, tooltip: "ReplayGain data not available" };
            y += fontInfo.Height;
        }
    } else {
        // hidden while rgAlpha==0; keep spacing
        y += fontInfo.Height;
    }

    y += 20;

    // PATH (shortened display, pathRect.path holds full)
    if (path) {
        var maxLinkW = Math.floor(ww * 0.9);
        var fullLabel = "Path: " + path;
        var displayText = shortenPath(gr, fullLabel, fontPath, maxLinkW);

        var pw = gr.CalcTextWidth(displayText, fontPath);
        var ph = fontPath.Height;
        var px = Math.floor((ww - pw) / 2);
        var py = y;

        var pcol = hoverPath ? 0xFFFFFFFF : colSub;
        gr.GdiDrawText(displayText, fontPath, pcol, px, py, pw, ph, 0);

        if (hoverPath) {
            gr.FillSolidRect(px, py + ph - 2, pw, 1, 0xFFFFFFFF);
        }

        pathRect = { x: px, y: py, w: pw, h: ph, path: path, displayText: displayText };
    } else {
        pathRect = null;
    }

    // DRAW overlay fade
    if (trackFade > 0) {
        var alpha = Math.max(0, Math.min(255, Math.floor(trackFade)));
        var col = (alpha << 24) | 0x000000;
        gr.FillSolidRect(0, 0, ww, wh, col);
    }

    // DRAW tooltip (if visible)
    if (tooltipVisible && tooltipText) {
        var padding = 6;
        var lines = tooltipText.split("\n");
        var maxW = 0;
        for (var i = 0; i < lines.length; i++) {
            var w = gr.CalcTextWidth(lines[i], fontSmall);
            if (w > maxW) maxW = w;
        }
        var tw = maxW + padding * 2;
        var th = (fontSmall.Height * lines.length) + padding * 2;
        var tx = tooltipX;
        var ty = tooltipY;
        if (tx + tw > ww) tx = ww - tw - 8;
        if (ty + th > wh) ty = wh - th - 8;

        gr.FillSolidRect(tx, ty, tw, th, 0xCC000000);
        gr.DrawRect(tx, ty, tw, th, 1, 0x80FFFFFF);
        for (var i = 0; i < lines.length; i++) {
            gr.GdiDrawText(lines[i], fontSmall, 0xFFFFFFFF, tx + padding, ty + padding + i * fontSmall.Height, tw - padding * 2, fontSmall.Height, 0);
        }
    }
}


// EVENTS
function on_size() {
    ww = window.Width;
    wh = window.Height;
}

function on_playback_time() {
    window.Repaint();
}

function on_playback_new_track() {
    isStopped = false;
    trackFade = 255;
    artistAnim = ARTIST_ANIM_START;
    startRgWait();
    pushCurrentTrack();
    window.Repaint();
}

function on_playback_starting() {
    isStopped = false;
    if (!currentTrack) currentTrack = fb.GetNowPlaying();
    trackFade = 255;
    artistAnim = ARTIST_ANIM_START;
    startRgWait();
}

function on_playback_stop() {
    isStopped = true;
    window.Repaint();
}


// MOUSE
function on_mouse_lbtn_up(x, y) {
    hideTooltip();

    for (var i = 0; i < starRects.length; i++) {
        var r = starRects[i];
        if (x >= r.x && x <= r.x + r.w &&
            y >= r.y && y <= r.y + r.h) {
            var m = fb.GetNowPlaying();
            if (m) fb.RunContextCommandWithMetadb("Rating/" + r.value, m);
            return;
        }
    }

    if (prevRect) {
        if (x >= prevRect.x && x <= prevRect.x + prevRect.w &&
            y >= prevRect.y && y <= prevRect.y + prevRect.h) {
            doPrev();
            return;
        }
    }
    if (nextRect) {
        if (x >= nextRect.x && x <= nextRect.x + nextRect.w &&
            y >= nextRect.y && y <= nextRect.y + nextRect.h) {
            doNext();
            return;
        }
    }

    var progWidth = Math.floor(ww * 0.7);
    var progX = Math.floor((ww - progWidth) / 2);
    var progH = 10;
    var progY = lastProgY;

    if (y >= progY && y <= progY + progH) {
        if (x >= progX && x <= progX + progWidth) {
            var frac = (x - progX) / progWidth;
            fb.PlaybackTime = fb.PlaybackLength * frac;
            return;
        }
    }

    if (pathRect) {
        if (x >= pathRect.x && x <= pathRect.x + pathRect.w &&
            y >= pathRect.y && y <= pathRect.y + pathRect.h) {
            var p = pathRect.path;
            p = p.replace(/^file:\/\//i, "");
            p = p.replace(/\//g, "\\");
            var escaped = p.replace(/"/g, '""');
            try {
                var sh = new ActiveXObject("WScript.Shell");
                sh.Run('explorer.exe /select,"' + escaped + '"');
            } catch (e) {
                fb.ShowPopupMessage("Cannot open folder:\n" + e, "Error");
            }
            return;
        }
    }
}

function on_mouse_move(x, y) {
    lastMouseX = x;
    lastMouseY = y;

    // HOVER PATH
    var hp = false;
    if (pathRect) {
        if (x >= pathRect.x && x <= pathRect.x + pathRect.w &&
            y >= pathRect.y && y <= pathRect.y + pathRect.h) {
            hp = true;
        }
    }
    if (hp !== hoverPath) {
        hoverPath = hp;
        window.Repaint();
    }

    // HOVER PROGRESS
    var progWidth = Math.floor(ww * 0.7);
    var progX = Math.floor((ww - progWidth) / 2);
    var progH = 10;
    var progY = lastProgY;
    var hpr = false;
    if (y >= progY && y <= progY + progH &&
        x >= progX && x <= progX + progWidth) hpr = true;
    if (hpr !== hoverProg) { hoverProg = hpr; window.Repaint(); }

    // HOVER STARS
    var hs = 0;
    for (var i = 0; i < starRects.length; i++) {
        var r = starRects[i];
        if (x >= r.x && x <= r.x + r.w &&
            y >= r.y && y <= r.y + r.h) {
            hs = r.value;
            break;
        }
    }
    if (hs !== hoverStar) { hoverStar = hs; window.Repaint(); }

    // HOVER prev/next
    var hpv = false, hnx = false;
    if (prevRect) {
        if (x >= prevRect.x && x <= prevRect.x + prevRect.w &&
            y >= prevRect.y && y <= prevRect.y + prevRect.h) hpv = true;
    }
    if (nextRect) {
        if (x >= nextRect.x && x <= nextRect.x + nextRect.w &&
            y >= nextRect.y && y <= nextRect.y + nextRect.h) hnx = true;
    }
    if (hpv !== hoverPrev || hnx !== hoverNext) { hoverPrev = hpv; hoverNext = hnx; window.Repaint(); }

    // decide hovered target and schedule/hide tooltip
    var newTarget = null;
    var tText = "";

    if (pathRect && x >= pathRect.x && x <= pathRect.x + pathRect.w &&
        y >= pathRect.y && y <= pathRect.y + pathRect.h) {
        newTarget = "path";
        tText = pathRect.path;
    } else if (rgRect && x >= rgRect.x && x <= rgRect.x + rgRect.w &&
               y >= rgRect.y && y <= rgRect.y + rgRect.h) {
        newTarget = "rg";
        tText = rgRect.tooltip || "";
    } else if (hoverProg) {
        newTarget = "prog";
        var pt = fb.TitleFormat("%playback_time%").Eval();
        var pl = fb.TitleFormat("%length%").Eval();
        tText = pt + " / " + pl;
    } else if (hoverStar > 0) {
        newTarget = "star";
        var curRating = tfInt("%rating%");
        tText = "Click to set rating: " + hoverStar + "\nCurrent rating: " + (curRating || "none");
    } else if (artistRectGlobal && x >= artistRectGlobal.x && x <= artistRectGlobal.x + artistRectGlobal.w &&
               y >= artistRectGlobal.y && y <= artistRectGlobal.y + artistRectGlobal.h) {
        newTarget = "artist";
        var albumInfo = tf("%album%") || "(no album)";
        var yr = tf("$left(%date%,4)") || "";
        tText = "Artist: " + tf("%artist%") + "\nAlbum: " + albumInfo + (yr ? ("\nYear: " + yr) : "");
    } else if (prevRect && x >= prevRect.x && x <= prevRect.x + prevRect.w &&
               y >= prevRect.y && y <= prevRect.y + prevRect.h) {
        // build up to 5 last history items (most recent first)
        newTarget = "prev";
        if (!history.length) tText = "History is empty";
        else {
            var lines = [];
            for (var i = history.length - 1, c = 0; i >= 0 && c < 5; i--, c++) {
                try {
                    lines.push((c+1) + ". " + formatHandleShort(history[i]));
                } catch (e) {}
            }
            tText = lines.join("\n");
        }
    } else if (nextRect && x >= nextRect.x && x <= nextRect.x + nextRect.w &&
               y >= nextRect.y && y <= nextRect.y + nextRect.h) {
        newTarget = "next";
        if (!future.length) tText = "Future is empty";
        else {
            var lines2 = [];
            for (var j = future.length - 1, c2 = 0; j >= 0 && c2 < 5; j--, c2++) {
                try {
                    lines2.push((c2+1) + ". " + formatHandleShort(future[j]));
                } catch (e) {}
            }
            tText = lines2.join("\n");
        }
    } else {
        newTarget = null;
    }

    if (newTarget !== tooltipTarget) {
        hideTooltip();
        if (newTarget) {
            scheduleTooltip(tText, x, y, newTarget);
        }
    }
}

// init
currentTrack = fb.GetNowPlaying();
trackFade = 200;
artistAnim = 0;
rgWaiting = false;
rgWaitStart = 0;
rgAlpha = 255;

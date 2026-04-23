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
var lastProgY = 0;

var animTick = 0;
var animTimer = null;

var isStopped = false;
var stopFade = 0; // 0–255
var stopPulse = 0;
var stopPulseDir = 1;


// ANIMACJA (STOP + ogólne odświeżanie)
function startAnim() {
    animTick++;

    // FADE-IN / FADE-OUT STOP
    if (isStopped && stopFade < 255) stopFade += 15;
    if (!isStopped && stopFade > 0)  stopFade -= 15;

    // PULS STOP KWADRATU
    stopPulse += stopPulseDir * 8;
    if (stopPulse > 80) { stopPulse = 80; stopPulseDir = -1; }
    if (stopPulse < 0)  { stopPulse = 0;  stopPulseDir = 1; }

    window.Repaint();
    animTimer = window.SetTimeout(startAnim, 50); // ~20 FPS
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

    // delikatny puls koloru progressa
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


// RYSOWANIE
function on_paint(gr) {
    gr.FillSolidRect(0, 0, ww, wh, colBg);

    // === STOP MODE (FADE + PULS) ===
    if (stopFade > 0) {

        // półprzezroczysta warstwa fade
        var fadeCol = (stopFade << 24) | 0x000000;
        gr.FillSolidRect(0, 0, ww, wh, fadeCol);

        // napis
        var msg = "Zatrzymano";
        var w = gr.CalcTextWidth(msg, fontTitle);
        var h = fontTitle.Height;
        var x = (ww - w) / 2;
        var y = (wh - h) / 2 - 40;

        gr.GdiDrawText(msg, fontTitle, 0x80FFFFFF, x, y, w, h, 0);

        // pulsujący kwadrat STOP
        var size = 40 + stopPulse / 4;
        var sx = (ww - size) / 2;
        var sy = y + h + 40;

        var alpha = 120 + stopPulse; // puls jasności
        var col = (alpha << 24) | 0xFFFFFF;

        gr.FillSolidRect(sx, sy, size, size, col);

        // dopóki fade jest wyraźny → nie rysujemy panelu pod spodem
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

    if (artist) y = drawCentered(gr, "> " + artist + " <", fontArtist, colText, y);
    if (title)  y = drawCentered(gr, title, fontTitle, colText, y + 5);

    // === RATING (KLIKALNE GWIAZDKI) ===
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
    if (year)  albumLine += (album ? "  " : "") + "Rok: " + year;
    if (albumLine) y = drawCentered(gr, albumLine, fontInfo, colSub, y + 5);

    y += 15;

    var status = isPlaying ? (isPaused ? "⏸" : "▶") : "■";
    var pcText = (playCount ? playCount : "") + "  " + status;
    y = drawCentered(gr, pcText, fontSmall, colSub, y);

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

    if (gain || peak) {
        var rgText = "";
        if (gain) rgText += "Gain: " + gain;
        if (peak) {
            var p = parseFloat(peak);
            var pct = isNaN(p) ? "" : Math.round(p * 100) + "%";
            if (rgText) rgText += "  |  ";
            if (!isNaN(p) && p > 1) rgText += "UWAGA! Szczyt > 1: " + pct;
            else if (pct) rgText += "Szczyt: " + pct;
        }
        y = drawCentered(gr, rgText, fontInfo, colText, y);
    } else {
        y = drawCentered(gr, "Brak ReplayGain!", fontInfo, colWarn, y);
    }

    y += 20;

    if (path) {
        var text = "path: " + path;
        var pw = gr.CalcTextWidth(text, fontPath);
        var ph = fontPath.Height;
        var px = (ww - pw) / 2;
        var py = y;

        var pcol = hoverPath ? 0xFFFFFFFF : colSub;
        gr.GdiDrawText(text, fontPath, pcol, px, py, pw, ph, 0);

        if (hoverPath) {
            gr.FillSolidRect(px, py + ph - 2, pw, 1, 0xFFFFFFFF);
        }

        pathRect = { x: px, y: py, w: pw, h: ph, path: path };
    } else {
        pathRect = null;
    }
}


// ZDARZENIA PLAYBACKU
function on_size() {
    ww = window.Width;
    wh = window.Height;
}

function on_playback_time() {
    window.Repaint();
}

function on_playback_new_track() {
    isStopped = false;
    window.Repaint();
}

function on_playback_starting() {
    isStopped = false;
}

function on_playback_stop() {
    isStopped = true;
    window.Repaint();
}


// MYSZ
function on_mouse_lbtn_up(x, y) {

    // === CLICK STARS → SET RATING ===
    for (var i = 0; i < starRects.length; i++) {
        var r = starRects[i];
        if (x >= r.x && x <= r.x + r.w &&
            y >= r.y && y <= r.y + r.h) {

            var m = fb.GetNowPlaying();
            if (m) {
                fb.RunContextCommandWithMetadb("Rating/" + r.value, m);
            }
            return;
        }
    }

    // === SEEK NA PROGRESSBARZE ===
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

    // === KLIKALNY PATH → OTWÓRZ FOLDER + ZAZNACZ PLIK ===
    if (pathRect) {
        if (x >= pathRect.x && x <= pathRect.x + pathRect.w &&
            y >= pathRect.y && y <= pathRect.y + pathRect.h) {

            var p = pathRect.path;
            var escaped = p.replace(/"/g, '""');

            try {
                var sh = new ActiveXObject("WScript.Shell");
                sh.Run('explorer.exe /select,"' + escaped + '"');
            } catch (e) {
                fb.ShowPopupMessage("Nie można otworzyć folderu:\n" + e, "Błąd");
            }
            return;
        }
    }
}

function on_mouse_move(x, y) {

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

    // HOVER PROGRESSBAR
    var progWidth = Math.floor(ww * 0.7);
    var progX = Math.floor((ww - progWidth) / 2);
    var progH = 10;
    var progY = lastProgY;

    var hpr = false;
    if (y >= progY && y <= progY + progH &&
        x >= progX && x <= progX + progWidth) {
        hpr = true;
    }
    if (hpr !== hoverProg) {
        hoverProg = hpr;
        window.Repaint();
    }

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
    if (hs !== hoverStar) {
        hoverStar = hs;
        window.Repaint();
    }
}

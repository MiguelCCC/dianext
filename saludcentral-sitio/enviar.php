<?php
/**
 * SALUD CENTRAL UT - Receptor de formularios de Atención al Usuario
 * Envía las solicitudes (con adjuntos) al correo de atención.
 *
 * Para que el correo SIEMPRE llegue (recomendado con Microsoft 365):
 * activa el envío por SMTP llenando el bloque de abajo.
 */

// =======================================================================
// CONFIGURACIÓN DE ENVÍO POR SMTP  (recomendado)
// -----------------------------------------------------------------------
// 1) Pon $SMTP_HABILITADO = true
// 2) Llena usuario y contraseña (de preferencia una "contraseña de aplicación")
// 3) Sube este archivo y la carpeta PHPMailer a public_html
// =======================================================================
$SMTP_HABILITADO   = false;                      // <-- ponlo en true cuando llenes los datos
$SMTP_HOST         = 'smtp.office365.com';        // Microsoft 365 (Gmail: smtp.gmail.com)
$SMTP_PORT         = 587;                         // 587 = TLS  |  465 = SSL
$SMTP_SEGURIDAD    = 'tls';                       // 'tls' (587) o 'ssl' (465)
$SMTP_USER         = 'pqr.interno@saludcentralut.com'; // correo remitente autenticado
$SMTP_PASS         = '';                          // <-- contraseña o contraseña de aplicación
$SMTP_FROM_NOMBRE  = 'SALUD CENTRAL UT';
// =======================================================================

$DESTINO = 'pqr.interno@saludcentralut.com';      // a dónde llegan las solicitudes
$FROM    = 'no-reply@saludcentralut.com';         // remitente para el modo mail()

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    header("Location: tramites.html");
    exit;
}

function limpiar($v) {
    $v = is_string($v) ? $v : (string)$v;
    return trim(strip_tags($v));
}
function una_linea($v) {
    return preg_replace('/[\r\n]+/', ' ', limpiar($v));
}
// Radicado consecutivo con trazabilidad: UT.PQRSFT.001, UT.PQRSFT.002, ...
function generarRadicado($dir) {
    $archivo = $dir . '/contador_pqrsft.txt';
    $num = 0;
    $fp = @fopen($archivo, 'c+');
    if ($fp) {
        flock($fp, LOCK_EX);
        $contenido = trim(stream_get_contents($fp));
        $num = ($contenido === '' ? 0 : intval($contenido)) + 1;
        rewind($fp); ftruncate($fp, 0); fwrite($fp, (string)$num); fflush($fp);
        flock($fp, LOCK_UN); fclose($fp);
    } else {
        $num = (int)(time() % 1000);
    }
    return 'UT.PQRSFT.' . str_pad((string)$num, 3, '0', STR_PAD_LEFT);
}

// Tipo de formulario
$tipo = una_linea($_POST['tipo_formulario'] ?? 'Formulario web');
$es_pqrs = (stripos($tipo, 'PQRS') !== false || stripos($tipo, 'Buz') !== false);

// Radicado (solo para PQRS)
$radicado = $es_pqrs ? generarRadicado(__DIR__) : '';

// Correo para respuesta (Reply-To)
$reply = filter_var($_POST['correo_respuesta'] ?? ($_POST['correo'] ?? ($_POST['correo_entrega'] ?? '')), FILTER_VALIDATE_EMAIL);

// ---- Cuerpo del mensaje ----
$cuerpo  = "Nueva solicitud recibida desde el sitio web.\n";
$cuerpo .= "Formulario: " . $tipo . "\n";
if ($radicado !== '') $cuerpo .= "Radicado: " . $radicado . "\n";
$cuerpo .= str_repeat("=", 55) . "\n\n";

foreach ($_POST as $campo => $valor) {
    if ($campo === 'tipo_formulario') continue;
    if (is_array($valor)) $valor = implode(', ', array_map('limpiar', $valor));
    else $valor = limpiar($valor);
    if ($valor === '') continue;
    $etiqueta = ucwords(str_replace('_', ' ', $campo));
    $cuerpo .= $etiqueta . ": " . $valor . "\n";
}
$cuerpo .= "\n" . str_repeat("-", 55) . "\n";
$cuerpo .= "Enviado el: " . date('Y-m-d H:i:s') . "\n";
$cuerpo .= "IP de origen: " . ($_SERVER['REMOTE_ADDR'] ?? 'N/D') . "\n";

// ---- Adjuntos (soportes[]) ----
$PERMITIDAS = ['pdf','jpg','jpeg','png','gif','doc','docx','xls','xlsx','ppt','pptx','txt','msg','zip'];
$MAX = 9 * 1024 * 1024; // 9 MB por archivo
$MAX_ARCHIVOS = 30;
$adjuntos = [];
if (isset($_FILES['soportes']) && is_array($_FILES['soportes']['name'])) {
    $n = count($_FILES['soportes']['name']);
    for ($i = 0; $i < $n; $i++) {
        if (count($adjuntos) >= $MAX_ARCHIVOS) break;
        if ($_FILES['soportes']['error'][$i] !== UPLOAD_ERR_OK) continue;
        if ($_FILES['soportes']['size'][$i] <= 0 || $_FILES['soportes']['size'][$i] > $MAX) continue;
        $ext = strtolower(pathinfo($_FILES['soportes']['name'][$i], PATHINFO_EXTENSION));
        if (!in_array($ext, $PERMITIDAS)) continue;
        $nombre = preg_replace('/[^A-Za-z0-9._-]/', '_', basename($_FILES['soportes']['name'][$i]));
        $datos = @file_get_contents($_FILES['soportes']['tmp_name'][$i]);
        if ($datos === false) continue;
        $adjuntos[] = ['nombre' => $nombre, 'datos' => $datos];
    }
}

// ---- Asunto ----
if (stripos($tipo, 'Historia') !== false || stripos($tipo, 'Documento') !== false) {
    $pn = una_linea($_POST['paciente_nombres'] ?? '');
    $pd = una_linea($_POST['paciente_numero_documento'] ?? '');
    $pe = una_linea($_POST['paciente_establecimiento'] ?? '');
    $asunto_txt = "Solicitud Documentos - " . trim($pn . " " . $pd) . ($pe !== '' ? " - " . $pe : "");
} elseif ($es_pqrs) {
    $mot = una_linea($_POST['motivo'] ?? 'PQRS');
    $pn = una_linea($_POST['paciente_nombres'] ?? '');
    $pd = una_linea($_POST['paciente_numero_documento'] ?? '');
    $pe = una_linea($_POST['establecimiento'] ?? '');
    $asunto_txt = $mot . " - " . trim($pn . " " . $pd) . ($pe !== '' ? " - " . $pe : "");
} else {
    $asunto_txt = "[$tipo] Nueva solicitud web";
}

$ok = false;

// ===================== ENVÍO POR SMTP (recomendado) =====================
if ($SMTP_HABILITADO && $SMTP_USER !== '' && $SMTP_PASS !== '' && is_dir(__DIR__ . '/PHPMailer')) {
    require_once __DIR__ . '/PHPMailer/Exception.php';
    require_once __DIR__ . '/PHPMailer/PHPMailer.php';
    require_once __DIR__ . '/PHPMailer/SMTP.php';
    $mail = new PHPMailer\PHPMailer\PHPMailer(true);
    try {
        $mail->isSMTP();
        $mail->Host       = $SMTP_HOST;
        $mail->SMTPAuth   = true;
        $mail->Username   = $SMTP_USER;
        $mail->Password   = $SMTP_PASS;
        $mail->SMTPSecure = ($SMTP_SEGURIDAD === 'ssl') ? 'ssl' : 'tls';
        $mail->Port       = (int)$SMTP_PORT;
        $mail->CharSet    = 'UTF-8';
        $mail->setFrom($SMTP_USER, $SMTP_FROM_NOMBRE);
        $mail->addAddress($DESTINO);
        if ($reply) $mail->addReplyTo($reply);
        $mail->Subject = $asunto_txt;
        $mail->Body    = $cuerpo;
        foreach ($adjuntos as $a) { $mail->addStringAttachment($a['datos'], $a['nombre']); }
        $mail->send();
        $ok = true;
    } catch (\Throwable $e) {
        $ok = false;
    }
}

// ===================== ENVÍO POR mail() (respaldo) =====================
if (!$ok) {
    $asunto = "=?UTF-8?B?" . base64_encode($asunto_txt) . "?=";
    if (count($adjuntos) > 0) {
        $sep = "==BORDE_" . md5(uniqid((string)time(), true));
        $headers  = "MIME-Version: 1.0\r\n";
        $headers .= "From: $SMTP_FROM_NOMBRE <$FROM>\r\n";
        if ($reply) $headers .= "Reply-To: $reply\r\n";
        $headers .= "Content-Type: multipart/mixed; boundary=\"$sep\"\r\n";
        $msg  = "--$sep\r\n";
        $msg .= "Content-Type: text/plain; charset=UTF-8\r\n";
        $msg .= "Content-Transfer-Encoding: 8bit\r\n\r\n";
        $msg .= $cuerpo . "\r\n\r\n";
        foreach ($adjuntos as $a) {
            $msg .= "--$sep\r\n";
            $msg .= "Content-Type: application/octet-stream; name=\"" . $a['nombre'] . "\"\r\n";
            $msg .= "Content-Transfer-Encoding: base64\r\n";
            $msg .= "Content-Disposition: attachment; filename=\"" . $a['nombre'] . "\"\r\n\r\n";
            $msg .= chunk_split(base64_encode($a['datos'])) . "\r\n";
        }
        $msg .= "--$sep--";
        $ok = @mail($DESTINO, $asunto, $msg, $headers, "-f $FROM");
    } else {
        $headers  = "MIME-Version: 1.0\r\n";
        $headers .= "From: $SMTP_FROM_NOMBRE <$FROM>\r\n";
        if ($reply) $headers .= "Reply-To: $reply\r\n";
        $headers .= "Content-Type: text/plain; charset=UTF-8\r\n";
        $ok = @mail($DESTINO, $asunto, $cuerpo, $headers, "-f $FROM");
    }
}

// ---- Trazabilidad PQRS ----
if ($radicado !== '') {
    @file_put_contents(__DIR__ . '/radicados_pqrsft.log',
        date('Y-m-d H:i:s') . " | " . $radicado . " | " . una_linea($_POST['motivo'] ?? '') . " | " . una_linea($_POST['paciente_nombres'] ?? '') . " | " . ($ok ? 'ENVIADO' : 'ERROR') . "\n",
        FILE_APPEND | LOCK_EX);
}

$estado = $ok ? "enviado=1" : "error=1";
$extra  = ($radicado !== '') ? "&radicado=" . rawurlencode($radicado) : "";
header("Location: tramites.html?$estado&tipo=" . rawurlencode($tipo) . $extra);
exit;
?>

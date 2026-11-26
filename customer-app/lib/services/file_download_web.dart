import 'dart:js_interop';

import 'package:web/web.dart' as web;

void downloadCsv(String filename, String csv) {
  final blob = web.Blob([csv.toJS].toJS, web.BlobPropertyBag(type: 'text/csv'));
  final url = web.URL.createObjectURL(blob);
  try {
    final anchor = web.HTMLAnchorElement()
      ..href = url
      ..download = filename;
    anchor.click();
  } finally {
    web.URL.revokeObjectURL(url);
  }
}

import 'package:dio/dio.dart';
import 'package:dio/browser.dart';

void configureSessionTransport(Dio dio) {
  (dio.httpClientAdapter as BrowserHttpClientAdapter).withCredentials = true;
}

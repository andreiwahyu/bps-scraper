"use strict"
process.env['DEBUG'] = 'horseman';

var Horseman = require('node-horseman'), //library untuk scrapping , horseman adalah penghubung nodeJs dengan phantomJs
fs = require('fs'), // library untuk pengelolaan fileSystem
request = require('request'), //library untuk proses hhtp get post dsb
mysql = require('mysql'), // library mysql untuk nodeJs
horseman = new Horseman({ // proses instance horseman
  timeout: 60000,
  loadImages: false,
  diskCache : true
}),

pool = mysql.createPool({ // proses instance mysql
  host     : 'localhost',
  user     : 'root',
  password : '',
  database : 'bps_jateng'
});

//v3
var dataFinal = [], // variabel untuk menampung semua data non Pdf
    urls = [], // variabel untuk menampung semua url page
    urlpdf= []; // variabel untuk menampung semua data Pdf

var download = function(dir,uri, callback){ //fungsi untuk mendownload segala object yang ada di web (image atau fileText seperti pdf)
  if (!fs.existsSync(dir)){ // mengecek apakah direktori ada
    fs.mkdirSync(dir); // jika tidak ada membuat direktori
  }

  request.head(uri, function(err, res, body){
    var filename = uri.replace(/^.*[\\\/]/, ''); //proses pengambilan kata terkhir setelah / terakhir pada url menggunakan regex sebagai nama file
    request(uri).pipe(fs.createWriteStream(dir +'/'+ filename)).on('close', callback); //proses request Get berdasarkan url kemudian jika selesai dilanjutkan (menggunakan pipe) membuat file tersebut
  });
}

function getData(){ // proses scrapping data
 return horseman.evaluate( function(){
	 var datas = [];
	 $(".pub").each(function( item ){
		 var nomor = $(this).find(".thumbnail-nomor-katalog");
     var urlCover ='http://jateng.bps.go.id' + $(this).find("img").attr("src");
		 var data = {
			 judul : $(this).find("div.thumbnail-judul-publikasi").text(),
			 katalog : $(nomor[0]).text(),
			 publikasi : $(nomor[1]).text(),
			 isbn : $(nomor[2]).text(),
			 tanggal_release : $(this).find("span.tanggal-rilis").text(),
			 abstrak : $(this).find(".thumbnail-abstrak-publikasi").text().trim(),
			 cover :  urlCover
		 };
		 datas.push(data);
	 });
	 return datas;
 });
}

function hasNextPage(){ // funsgi untuk pengecekan apakah ada tombol next
 return horseman.exists(".next.hidden"); //menggunakan next hidden karena bila pada page terakhir tombol selanjutnya akan di hidden memiliki class .next.hidden
}

function scrape(){ // proses rekursif untuk mengambil setiap data pada halaman
 return new Promise( function( resolve, reject ){ // promise dalam javascript untuk proses synchronous karena javascript sejatinya asynchronous , detail ada disini => https://www.promisejs.org/
	 return getData() // pemanggilan fungsi proses scrapping
	 .then(function(datas){ // data return hasil scrapping pada fungsi getData berupa parameter datas
		 dataFinal = dataFinal.concat(datas); // dataFinal untuk menampung semua data
				return hasNextPage() // pengecekan tombol selanjutnya
				 .then(function(hasNext){ // hasil return fungsi pengecekan tombol selanjutnya
           if (!hasNext){ // pengecekan bila hasNext berupa false maka tombol selanjutnya masih nampak pada page
						 return horseman
							 .evaluate( function(){ // evaluate dalam library horseman untuk mengeksekusi script javascript native/asli dalam sandbox (f12 pada chrome)
                 //script untuk klik tombol selanjutnya
                  var btn  = $("li.next > a")[0];
									var ev = document.createEvent("MouseEvent");
									ev.initMouseEvent(
											"click",
											true /* bubble */, true /* cancelable */,
											window, null,
											0, 0, 0, 0, /* coordinates */
											false, false, false, false, /* modifier keys */
											0 /*left*/, null
									);
                  btn.dispatchEvent(ev);
							 })
               //proses menunggu halaman selanjutnya terbuka
               .waitForNextPage()
							 .then( scrape ); //rekursif
					 }
				 });
	 })
	 .then( resolve ); //untuk mengakhiri proses
 });
}

function collectData(){ // funsgi untuk save data kedalam database
  var datas = [];
  for(var i=0; i< dataFinal.length;i++){
    dataFinal[i].pdf = urlpdf[i];
  }

  dataFinal.forEach(function (data) {
    pool.getConnection(function(err, connection) {
      var post = { // variabel post digunakan untuk koleksi data kolom table (bagian kiri sebelum : ) dan isinya (bagian kanan setelah : ) yang akan di insert
            judul : data.judul,
            isbn : data.isbn,
            katalog :  data.katalog,
            publikasi : data.publikasi,
            tanggal_rilis : data.tanggal_release,
            abstrak	: data.abstrak,
            cover : data.cover.replace(/^.*[\\\/]/, ''), //proses pengambilan kata terkhir setelah terakhir pada url menggunakan regex sebagai nama file
            pdf : data.pdf.replace(/^.*[\\\/]/, '') //proses pengambilan kata terkhir setelah terakhir pada url menggunakan regex sebagai nama file
          }
      connection.query('INSERT INTO scrap SET ?', post, function(err, result) {
          if (err) throw err;
          console.log(result.insertId);
        });
        connection.release();
      });
   });
}

function downloadPdfData(i){ //funsgi download pdf dengan parameter berupa index untuk proses rekursif
  if(urlpdf.length != i ){
    download('pdf',urlpdf[i], function(){ // proses download
      console.log('pdf done : ' + urlpdf[i]);
      console.log( (i+1) +" dari " + urlpdf.length );
      console.log("");

      downloadPdfData(++i); //rekursif
    });
  }
  else{
    console.log("download pdf Selesai");
  }
}

function downloadImageData(i){ //funsgi download image dengan parameter berupa index untuk proses rekursif
  if(dataFinal.length != i ){
    download('cover',dataFinal[i].cover, function(){ // proses download
      console.log('image done : ' + dataFinal[i].cover);
      console.log( (i+1) +" dari " + dataFinal.length );
      console.log("");

      downloadImageData(++i); //rekursif
    });
  }else{
      console.log("download image Selesai");
  }
}

var start = function(i){//funsgi pengambilan url pdf dengan click semua tombol dengan parameter berupa index untuk proses rekursif
  if(urls.length != i){
        var promise = new Promise(function(resolve, reject) {
          const jaran = new Horseman({ // proses instance horseman
            timeout: 60000,
            loadImages: false,
            diskCache : true
          });
          jaran
           .userAgent("Mozilla/5.0 (Windows NT 6.1; WOW64; rv:27.0) Gecko/20100101 Firefox/27.0")
           .timeout(60000)
           .on('loadFinished', function(msg) {
              console.log(msg);
              // var backup = horseman;
              // console.log(backup);
           })
           .on('error', function( msg, trace ){
              var msgStack = ['ERROR: ' + msg];
              if (trace && trace.length) {
                  msgStack.push('TRACE:');
                  trace.forEach(function(t) {
                      msgStack.push(' -> ' + t.file + ': ' + t.line + (t.function ? ' (in function "' + t.function + '")' : ''));
                  });
              }
              console.error(msgStack.join('\n'));
           })
           .on('consoleMessage', function(msg, lineNum, sourceId) {
             //pada file inject.js pada baris ke 4 terdapat proses manipulasi jika terjadi proses pembuatan tab baru (window.open) akan memberi pesan berupa url
              var pathPdf = 'http://jateng.bps.go.id'+msg;
              urlpdf.push(pathPdf);
              console.log(pathPdf);
           })
           .open(urls[i])
           .injectJs("inject.js")
           .evaluate( function(){
             //proses click semua tombol download pdf
                 $(".pub").each(function( item ){
                  var btn = $($(this)[0]).find("a")[0];
                  var event = document.createEvent('MouseEvent');
                  event.initEvent('click', true, true);
                  btn.dispatchEvent(event);
                });
           })
           .wait(1000)
           .finally(function(){
            jaran.close();
            resolve(i);// bukti proses selesai dan mengembalikan nilai berupa index
        });
      });
      promise.then(function(val) {//setelah proses selesai terjadi rekursif
          start(++val);
      })
  }else{
      collectData();
      downloadPdfData(0);
      downloadImageData(0);
  }
}


//proses berjalannya program terjadi 2 kali
//pertama untuk pengambilan semua data di setiap halaman
//kedua untuk proses klik tombol download pdf  di setiap halaman
//start program dari sini
horseman
 .userAgent("Mozilla/5.0 (Windows NT 6.1; WOW64; rv:27.0) Gecko/20100101 Firefox/27.0")
 .on('urlChanged', function(targetUrl) { // event apabila mengalami perubahan url opada jalannya program
		urls.push(targetUrl); // proses penambahan url yang nantinya untuk eksekusi tombol donwload pdf pada setiap halaman
    console.log(targetUrl);
 })
 .on('error', function( msg, trace ){ // untuk handle bila terjadi suatu error
		var msgStack = ['ERROR: ' + msg];
    if (trace && trace.length) {
        msgStack.push('TRACE:');
        trace.forEach(function(t) {
            msgStack.push(' -> ' + t.file + ': ' + t.line + (t.function ? ' (in function "' + t.function + '")' : ''));
        });
    }
    console.error(msgStack.join('\n'));
 })
 .open("http://jateng.bps.go.id/index.php/publikasi/")
 .then( scrape ) // memanggil fungsi scrap untuk mengambil setiap data non pdf di semua page
 .finally(function(){
	 horseman.close();
   start(0); // memanggil fungsi scrap untuk mengambil setiap data non pdf di semua page
 });

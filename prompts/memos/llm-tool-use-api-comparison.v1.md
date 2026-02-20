# **LLM API間におけるTool UseおよびTool Resultデータ構造の包括的構造解析と統合中間フォーマットの策定**

大規模言語モデル（LLM）が単なるテキスト生成エンジンから、外部の計算リソース、データベース、およびAPIと自律的に対話する「エージェント」へと進化する過程において、関数呼び出し（Function Calling）およびツール使用（Tool Use）のメカニズムは不可欠な基盤技術となっている。このパラダイムシフトを実現するため、OpenAI、Anthropic、およびGoogle（Vertex AIならびにGoogle GenAI）といった主要な基盤モデルプロバイダーは、モデルが外部ツールを要求し、その実行結果を受け取るための専用のデータ構造（スキーマ）を各々のREST API内に実装している。しかしながら、これらのプロバイダー間におけるAPIアーキテクチャの設計思想、データ型の取り扱い、および並列処理時の識別子（ID）の管理手法には顕著な断絶が存在する。

本報告書は、ミドルウェア層においてこれらの非互換性を吸収し、すべての主要APIを統一的に操作可能な「中間フォーマット（Intermediate Format）」を策定することを目的とする。そのための基礎調査として、各APIが「Tool Use（モデルからのツール呼び出し要求）」および「Tool Result（アプリケーションからモデルへの実行結果の返却）」に相当するフェーズで要求するデータ構造の詳細を徹底的に解剖する。特に、要求仕様において言及されている「contentフィールドが文字列（string）である場合、それが純粋なテキストを保持するのか、あるいはJSON構造をシリアライズして保持するのか」、および「resultフィールドがRecord\<...\>（オブジェクト）である場合、そのキーと値には具体的に何が格納されるべきか」というデータ型の厳密な境界線とシリアライゼーションの要件について、プロバイダーごとの仕様を比較・分析し、その根本的な設計思想を明らかにする。

## **1\. OpenAI APIにおけるツールオーケストレーションの構造解析**

OpenAI APIは、Chat Completionsエンドポイントを通じてツール呼び出し機能を提供しており、メッセージの「役割（role）」と特定のオブジェクト配列を駆使することでツールとの対話を管理している。OpenAIの設計アプローチは、トークンの自己回帰的な生成プロセス（ストリーミング）に最適化されており、その結果として引数や実行結果のデータ構造に独自のシリアライゼーションの負担をクライアント側に強いる特徴がある1。

### **1.1 Tool Useフェーズ：tool\_calls リクエスト構造**

OpenAIのモデルがユーザーのプロンプトを解析し、外部ツールの実行が必要であると判断した場合、モデルは通常のテキスト応答の代わりに、"assistant"ロールのメッセージ内にtool\_callsという配列を含めて応答を返す1。この配列構造は、モデルが複数のツールを同時に呼び出す「並列関数呼び出し（Parallel Function Calling）」をサポートするために採用されている。

この際のアシスタントメッセージのスキーマは以下の通り定義されている。

| フィールド名 | データ型 | 詳細な仕様と意味合い |
| :---- | :---- | :---- |
| role | string | 常に "assistant" が指定される。 |
| content | string | null | ツール呼び出しと同時に生成されたテキスト（モデルの思考過程やユーザーへの事前応答）が格納される。ツール呼び出しのみの場合は null となることが多い。 |
| tool\_calls | Array\<Object\> | モデルが要求するツールの詳細を記述した ChatCompletionMessageToolCall オブジェクトの配列。 |

この tool\_calls 配列内の各オブジェクトは、ツール実行のための具体的なパラメータを内包しており、その内部スキーマは以下の要素で構成される1。

| フィールド名 | データ型 | 詳細な仕様と意味合い |
| :---- | :---- | :---- |
| id | string | モデルによって自動生成される一意の識別子（例: call\_abc123）。このIDは、後続のフェーズで結果を返却する際に、どの要求に対する結果であるかを紐づけるために必須となる。 |
| type | string | 現在は常に "function" が指定される。将来的な拡張（独自のツールタイプなど）を見据えた設計である。 |
| function | Object | 呼び出される関数の中核的な情報を格納するネストされたオブジェクト。 |
| function.name | string | 実行すべき関数の名称。事前のツール定義で提供された名称と完全に一致する。 |
| function.arguments | string | **型制約上の最重要ポイント:** 関数の引数が、ネイティブなJSONオブジェクトではなく、\*\*JSON形式でフォーマットされた単一の「文字列」\*\*として格納される1。 |

**function.arguments における文字列型の採用理由とその影響** OpenAIが引数をパース済みのJSONオブジェクト（例：{ "location": "Tokyo", "unit": "celsius" }）ではなく、エスケープされたJSON文字列（例："{\\"location\\": \\"Tokyo\\", \\"unit\\": \\"celsius\\"}"）として設計した背景には、Server-Sent Events (SSE) を用いたストリーミング生成のメカニズムが深く関与している2。モデルはトークンを逐次生成するため、不完全なJSONをオブジェクトとしてネットワーク越しに送信することはデータ構造上不可能である。そのため、引数全体を一つの文字列として扱い、生成されるたびに文字列の断片を送信する手法がとられている3。

このアーキテクチャの直接的な影響として、クライアント側のアプリケーションやミドルウェアは、抽出した arguments に対して必ず JSON.parse() を実行し、ネイティブなプログラミング言語のオブジェクト（辞書型やハッシュマップなど）に変換してからローカルの関数に渡すという処理ステップを実装しなければならない4。さらに、モデルがハルシネーション（幻覚）を起こし、提供したJSONスキーマに存在しないパラメータを生成したり、不正なJSON文字列を出力したりするリスクが常に存在するため、実行前の厳格なスキーマバリデーションが不可欠となる1（ただし、最近導入された strict: true を指定する Structured Outputs を活用することで、このスキーマ逸脱のリスクはシステム側で100%排除することが可能となっている5）。

### **1.2 Tool Resultフェーズ：tool ロールにおける結果の返却**

クライアントアプリケーションが要求されたローカル関数を実行した後、その結果をモデルに返却し、会話の生成を再開させる必要がある。OpenAI APIでは、この結果の返却のために専用のメッセージロールである "tool" ロールが用意されている2。

実行結果を返却する際のメッセージ構造は以下の通りである。

| フィールド名 | データ型 | 詳細な仕様と意味合い |
| :---- | :---- | :---- |
| role | string | 常に "tool" が指定される。 |
| tool\_call\_id | string | 直前のアシスタントメッセージ内の tool\_calls 配列で提示された、対応するツールの id 文字列2。並列実行時には、このIDによってリクエストとレスポンスの対応関係が解決される。 |
| content | string | Array\<Object\> | ツールの実行結果のペイロード2。 |

**content: string の深層解析：結果テキストか、JSON構造か**

このセクションの核心となるのが、content フィールドの取り扱いである。OpenAIの仕様において、content は原則として string 型を要求する。ここで保存されるデータが「純粋なテキスト」なのか「JSON構造」なのかという問いに対する答えは、「ローカル関数が何を返したかによるが、最終的にはすべて文字列としてエンコードされなければならない」というものである。

具体的には以下の2つのパターンが存在する。

1. **結果が単純なテキストの場合：** ローカル関数が「在庫は十分にあります」といったプレーンテキストを返した場合、そのテキストはそのまま content: "在庫は十分にあります" として格納される。  
2. **結果が構造化データ（Record\<...\>）の場合：** 天気APIやデータベースクエリのように、ローカル関数が辞書型のオブジェクト（例：{ "temperature": 22, "condition": "sunny" }）を返した場合、OpenAIのAPIはそのネイティブオブジェクトを直接受け付けることはできない。したがって、ミドルウェアはこのオブジェクトに対して JSON.stringify() を実行し、JSON構造を保持したままの「文字列」として格納しなければならない（例：content: "{\\"temperature\\":22,\\"condition\\":\\"sunny\\"}"）4。この場合、スキーマ自体は開発者が実装した関数が返す任意のスキーマであり、OpenAI側が事前に特定のフォーマットを要求するものではない。モデルは、入力されたJSON文字列のセマンティクスを自身の言語理解能力で解釈し、最終的な回答を生成する。

また、最新のマルチモーダル機能の拡張により、content フィールドは単なる文字列だけでなく、ArrayOfContentParts（オブジェクトの配列）を受け入れるようになっている2。もしツールが画像を生成したり、PDFからドキュメントを抽出したりした場合、ミドルウェアは content を配列とし、その中に {"type": "text", "text": "結果の説明"} と {"type": "image\_url", "image\_url": {"url": "base64..."}} を混在させて送信する必要がある1。

## ---

**2\. Anthropic (Claude) APIにおけるツールオーケストレーションの構造解析**

Anthropicが提供するMessages APIは、OpenAIのアーキテクチャとは根本的に異なる設計アプローチを採用している。専用の "tool" ロールを使用するのではなく、既存の "user" と "assistant" の役割の中に「コンテンツブロック（Content Blocks）」という概念を導入し、その配列の中にツールの要求と結果をネストさせるという手法をとっている9。この設計は、人間とAIの対話という自然な文脈の中にシステム的なツール操作を直接埋め込むことを意図している。

### **2.1 Tool Useフェーズ：tool\_use コンテンツブロック**

Claudeがツールを呼び出す決定を下した場合、APIは stop\_reason として "tool\_use" を返し、"assistant" ロールのメッセージの content 配列の中に、一つまたは複数の "tool\_use" 型のブロックを含めて応答する9。

| フィールド名 | データ型 | 詳細な仕様と意味合い |
| :---- | :---- | :---- |
| type | string | 常に "tool\_use" となる。 |
| id | string | この呼び出しインスタンスに対する一意の識別子（例：toolu\_01D7FLrf...）9。 |
| name | string | 実行が要求されているツールの名称9。 |
| input | Object | **型制約上の最重要ポイント:** 生成されたパラメータを含む、**ネイティブなJSONオブジェクト（Record\<string, any\>）**9。 |

**input フィールドのオブジェクト指向性** OpenAIが引数を文字列として返していたのに対し、Anthropicの最大の差異はこの input フィールドにある。AnthropicのAPIは、サーバーサイドで生成されたJSON文字列を事前にパースし、完成された構造化オブジェクト（ハッシュマップや辞書型）としてクライアントに提供する9。これにより、開発者やミドルウェアは抽出した input に対して JSON.parse() を実行する手間が省け、そのままローカルの関数に引数として展開（アンパック）することが可能となっている。これは、ミドルウェアで両者を統一する際に、OpenAI側ではデシリアライズ処理を追加し、Anthropic側ではそのままパススルーするといった条件分岐を強いる主要な要因となる。

### **2.2 Tool Resultフェーズ：tool\_result コンテンツブロック**

ツールの実行結果は、新たな "user" ロールのメッセージを生成し、その content 配列内に "tool\_result" 型のブロックを配置することでClaudeに返却される9。ここでAnthropicは、メッセージの順序やブロックの配置に関して極めて厳格なバリデーションルールを設けている。

| フィールド名 | データ型 | 詳細な仕様と意味合い |
| :---- | :---- | :---- |
| type | string | 常に "tool\_result" となる。 |
| tool\_use\_id | string | 直前のアシスタント応答内の tool\_use ブロックで指定された一意の id をそのまま指定する9。 |
| content | string | Array\<Object\> | ツールの実行結果。文字列、またはテキスト、画像、ドキュメントの各ブロックをネストした配列9。 |
| is\_error | boolean | （オプション）ツールの実行がエラーに終わったかどうかを示すフラグ。デフォルトは false9。 |

**content の構造と JSON.stringify の要件** Anthropicにおける tool\_result の content フィールドもまた、OpenAIと同様の制約を抱えている。公式ドキュメントには「もし構造化されたJSONオブジェクトをClaudeに返したい場合、それを返却する前にJSON文字列へとエンコードしなければならない」と明記されている9。つまり、関数が Record\<string, any\> を返した場合、ミドルウェアはそれを直接 content の値として代入することはできず、JSON.stringify() を適用してプレーンな文字列に変換する必要がある。

さらに高度な構造として、Anthropicは複数の要素を持つ配列を content に渡すことを許可している。例えば、JSONの実行結果と合わせて抽出した画像を返したい場合、content は以下のような配列構造となる9。 content: \[ { "type": "text", "text": "{\\"status\\":\\"success\\"}" }, { "type": "image", "source": {...} } \]

**順序制約と is\_error のセマンティクス** Anthropic固有の厳格な仕様として、ユーザーメッセージ内の content 配列において、tool\_result ブロックは常に「最初」に配置されなければならないというルールがある9。もしプレーンテキスト（例えば「これが結果です」というプロンプト）を tool\_result ブロックよりも前に配置すると、APIは 400 Bad Request エラーを返却する9。

また、is\_error フラグの存在は、エラーハンドリングにおけるAnthropicのアーキテクチャ上の優位性を示している9。OpenAIやGoogle APIでは、ツール実行時に例外（APIのタイムアウトや認証エラーなど）が発生した場合、そのエラー内容を成功時と同じように文字列に変換し、モデルに「エラーが起きた」というテキストの文脈として理解させるしかない。一方、Anthropicでは is\_error: true を設定することで、システムレベルで明確に「ツールが失敗した」という状態をLLMに伝達できる。これにより、モデルは自発的に別の引数でツールを再試行したり、ユーザーに対して的確な謝罪と代替案の提示を行ったりするフォールバックロジックへの移行がスムーズになる9。

## ---

**3\. Google API (Vertex AI および Google GenAI) における構造解析**

GoogleはGeminiモデル群へのアクセス手段として、エンタープライズ向けの「Vertex AI API」と、開発者向けの「Google GenAI (Gemini Developer API)」の2つの主要なエンドポイントを提供している11。これらは認証方式（IAM vs APIキー）やプロジェクトの要件において異なるものの、背後で稼働しているREST APIのペイロードスキーマ（generateContent エンドポイントに対するリクエストとレスポンスの構造）は、関数呼び出しの領域において完全に統一されている13。

OpenAIやAnthropicがウェブベースのJSON設計やテキストチャットの延長線上にある設計を採用しているのに対し、GoogleのアーキテクチャはgRPCやProtocol Buffers（Protobuf）といった厳格な型付けを重んじるシステム基盤の影響を強く受けている。この影響は、ツールオーケストレーションにおける Struct 型の多用という形で最も顕著に現れる13。

### **3.1 Tool Useフェーズ：functionCall パート**

Geminiモデルが関数の実行を要求する際、標準のテキスト応答の代わりに、Content オブジェクト内の parts 配列に functionCall オブジェクトを含めて応答を生成する14。

| フィールド名 | データ型 | 詳細な仕様と意味合い |
| :---- | :---- | :---- |
| name | string | 実行すべき関数の名称。事前の FunctionDeclaration で定義された名称と一致する14。 |
| args | Struct (Object) | **型制約上の最重要ポイント:** 関数の引数と値のペアを格納する、**ネイティブなJSONオブジェクト（Record\<string, any\>）**14。 |
| thoughtSignature | string | （Gemini 2.0以降などの推論モデル）モデルの内部的な推論状態をカプセル化した不透明なトークン。後続のターンでコンテキストを維持するために必須となる場合がある13。 |

**args フィールドにおける完全なオブジェクトマッピング** Anthropicと同様に、Geminiも生成された引数を文字列ではなくパース済みのオブジェクト（Protobufの定義では Struct 型）として提供する14。これにより、response.candidates.content.parts.functionCall.args にアクセスするだけで、直接プログラミング言語の辞書オブジェクトとして値を取り出すことができる。

**並列実行におけるIDマッチングの欠如とインデックス依存の課題** OpenAIとAnthropicが各ツール呼び出しに対して明示的なUUID（tool\_call\_id等）を付与して結果とのマッピングを行っているのに対し、ネイティブなGemini REST APIの基本設計には、個々の関数呼び出しを一意に識別するための id フィールドが歴史的に存在しなかった17。Geminiは並列関数呼び出し（Parallel Function Calling）をサポートしており、複数の functionCall が配列として返されるが、その結果をモデルに返却する際、システムは「返却された functionResponse の配列の順序」が「呼び出し時の functionCall の配列の順序」と完全に一致していることを前提としてマッピングを解決する16。

この設計はミドルウェアの開発者にとって極めて厄介な問題を引き起こす。外部APIの実行時間が異なり、非同期処理によって結果の取得順序が入れ替わった場合、ミドルウェア側で意図的に元の functionCall の順番通りに結果配列を再ソートしてから送信しなければならない18。なお、OpenAI互換レイヤーや特定の最新SDKでは仮想的なID（例えば文字列化されたインデックス "0", "1"）が注入されるケースもあるが、根本的なRESTスキーマとしては配列の順序依存性が残っている17。

### **3.2 Tool Resultフェーズ：functionResponse パート**

関数の実行後、アプリケーションはその結果を functionResponse オブジェクトとしてパッケージ化し、それをユーザーロールの Content パートに含めてGeminiに送信する15。

| フィールド名 | データ型 | 詳細な仕様と意味合い |
| :---- | :---- | :---- |
| name | string | 呼び出された関数の名称14。 |
| response | Struct (Object) | **型制約上の最重要ポイント:** 実行結果を格納する、**ネイティブなJSONオブジェクト（Record\<string, any\>）**14。 |
| parts | Array\<FunctionResponsePart\> | （オプション）画像、音声、ビデオなどのマルチモーダルデータをJSONレスポンスとともに返すための配列14。 |

**response: Record\<...\> の厳密な型制約とペイロード構造** 本報告書における最も重要なアーキテクチャの差異がここにある。OpenAIとAnthropicが結果を「文字列（content: string）」として受け入れていたのに対し、**Geminiの response フィールドは厳格に Struct 型、すなわち Record\<string, any\> のJSONオブジェクトのみを受け付ける**14。

これはミドルウェア設計において決定的な制約となる。もし開発者が作成したローカル関数が、辞書型ではなく「単一の文字列（例："晴れです"）」や「単一の数値（例：25）」といったプリミティブなスカラー値を返した場合、それをそのまま response: "晴れです" のように代入しようとすると、API側で型不一致の 400 Bad Request エラーがトリガーされる15。

したがって、result: Record\<...\> におけるキーと値の具体的な中身に関する回答は以下のようになる。

* **関数の戻り値がJSONオブジェクトの場合：** 戻り値のキーと値のペアが、そのまま response オブジェクトのキーと値として格納される。（例：response: { "temperature": 25, "unit": "C" }）  
* **関数の戻り値がスカラー値（文字列や数値）の場合：** ミドルウェアやアプリケーション側で、任意のキー（一般的には "result", "value", "output" など）を定義し、そのオブジェクトでラップしなければならない。（例：response: { "result": "晴れです" }）15。

この厳格なオブジェクト指向のアプローチは、結果データの構造をAPIレイヤーで保証するという強みを持つ反面、単純なテキスト結果を戻すだけのシンプルなツールを設計する際にも、不要なオブジェクトのネストを強要するという煩雑さをもたらしている。

## ---

**4\. API間の型パラダイムとシリアライゼーションの断絶に基づく相違点分析**

上記で詳述した各APIのスキーマ構造を俯瞰すると、LLMモデルがツールを使用するという同一の概念的プロセスを実装しているにもかかわらず、そのデータ転送のパラダイムには埋めがたい断絶が存在することがわかる。統一的な中間フォーマットを策定するためには、以下の4つの運用次元における相違点（フリクション）を正確にマッピングし、変換ロジックを確立しなければならない。

### **4.1 引数（Arguments）の抽出とデシリアライズ戦略**

* **OpenAIのパラダイム：** 引数はエスケープされた単一のJSON文字列として提供される。ミドルウェアはストリームの終了を待ち、不完全な文字列を連結した上で、アプリケーションコードに渡す直前に JSON.parse() を実行する義務を負う1。  
* **Anthropic / Geminiのパラダイム：** 引数はネイティブなJSONオブジェクトとして提供される。ミドルウェアはデシリアライズのオーバーヘッドなしに、そのままプログラミング言語の辞書型として変数にアクセスし、関数に展開できる9。  
* **ミドルウェアの変換要件：** 中間フォーマットにおいては、引数は常に「プログラミング言語ネイティブなオブジェクト（Record\<string, any\>）」として標準化されるべきである。OpenAIのアダプター層でのみ、上り方向（モデルからシステムへ）の通信時に JSON.parse() のインターセプト処理を実装する。

### **4.2 実行結果（Results）のエンコーディング制約**

* **OpenAI / Anthropicのパラダイム（テキスト中心主義）：** 結果フィールド（content）は本質的に文字列領域として扱われる。したがって、ローカル関数が構造化されたJSONオブジェクトを返した場合、システムは下り方向（システムからモデルへ）の通信時に必ず JSON.stringify() を適用し、フラットな文字列にシリアライズしなければならない2。  
* **Geminiのパラダイム（オブジェクト中心主義）：** 結果フィールド（response）は厳格なオブジェクト（Struct）領域として扱われる。構造化JSONはそのまま格納できるが、逆にプレーンテキストを返す関数があった場合、システムはそれを {"result": "プレーンテキスト"} といった形式でオブジェクトコンテナにラップ（箱詰め）する処理を行わなければならない14。  
* **ミドルウェアの変換要件：** 中間フォーマットにおいて、結果ペイロードは Record\<string, any\> | string のユニオン型で柔軟に保持する。その後、OpenAI/Anthropic用のアダプターを通過する際はオブジェクトを強制的に文字列化し、Gemini用のアダプターを通過する際は文字列を強制的にオブジェクト化するという、双方向のミューテーションロジックが必須となる。

### **4.3 並列実行時における識別子（ID）の相関管理**

ツールの並列呼び出し（Parallel Tool Calling）が行われた場合、どの呼び出しに対する結果であるかをシステムが確実にトラッキングし、モデルに正しく紐づけて返すことは、エージェントの推論精度を維持する上で極めて重要である。

* **明示的IDアプローチ（OpenAI / Anthropic）：** モデル自身が call\_abc123 のような一意のUUIDを生成し、システムは結果を返す際にそのUUIDを添える。これにより、結果の返却順序が非同期処理によってシャッフルされたとしても、モデルは正確に対応関係を認識できる2。  
* **順序依存アプローチ（Geminiネイティブ）：** モデルは一意のIDを発行せず、name と配列のインデックス番号のみに依存する。システムは、呼び出された順番をメモリ上にバッファリングし、すべての非同期処理が完了した後、厳密に元の順番通りに配列を再構築してからAPIに送信しなければならない16。  
* **ミドルウェアの変換要件：** 中間フォーマットは、安全性を担保するために必ず一意の id フィールドを持つべきである。Geminiと通信する場合、Gemini用アダプターは受信時にミドルウェア側で一時的なローカルUUIDを生成して中間フォーマットに付与し、送信時にそのUUIDを用いてバッファを並び替え、最終的なペイロードからはUUIDを取り除いて送信するという状態管理（ステートマネジメント）の役割を担う必要がある。

### **4.4 エラー状態のカプセル化**

ローカル関数がデータベースの接続エラーやAPIのレートリミットに直面した場合の表現方法にも違いがある。

* Anthropicは tool\_result ブロック内にネイティブな is\_error: boolean フラグを用意しているため、エラー文字列とシステムフラグを分離してモデルに伝達できる9。  
* OpenAIとGeminiにはネイティブなエラーフラグが存在しないため、ミドルウェアは例外をキャッチした場合、そのエラーメッセージを「関数が正常に実行され、その結果として返ってきた文字列」として偽装し（例："Error: Database timeout"）、通常の content または response に代入して返す必要がある。モデルは文脈からそれがエラーであることを推論しなければならない。

## ---

**5\. 統合的な「中間フォーマット（Intermediate Format）」の設計仕様とマッピングアーキテクチャ**

前章までの徹底的な構造解析とパラダイムの比較に基づき、すべてのLLMプロバイダーのツールオーケストレーションを抽象化し、統一的に取り扱うための「中間フォーマット（Intermediate Representation: IR）」のデータ構造を定義する。このIRは、アプリケーションのビジネスロジックと、各プロバイダー独自のAPIスキーマとを分離するレイヤーとして機能する。

### **5.1 中間フォーマット策定の基本原則**

1. **ネイティブオブジェクトの維持:** 開発者の負担を軽減するため、引数（Arguments）および結果（Results）は、可能な限りシリアライズされていないネイティブなオブジェクト（Record\<string, any\>）としてIR内に保持する。シリアライズの義務は各API用のアダプターに押し付ける。  
2. **識別子の普遍化:** すべてのツールコールに対して、モデルが生成したかミドルウェアが生成したかを問わず、必ず一意の id を割り当てる。  
3. **エラーの明示:** Anthropicの先進的な設計に倣い、実行状態を示す is\_error フラグをIRの標準プロパティとして採用し、サポートしていないAPIに対してはアダプター内で文字列のフォールバックに変換する。

### **5.2 UniversalToolCall スキーマ定義（モデル → システム）**

モデルからシステムへのツール呼び出し要求を抽象化したデータ構造である。

| フィールド | 想定されるデータ型 | アダプターにおける変換ロジック（受信時の処理） |
| :---- | :---- | :---- |
| id | string | **OpenAI/Anthropic:** APIから提供されたネイティブのID（tool\_call.id や tool\_use.id）をそのままマッピングする。 **Gemini:** ミドルウェアが内部で UUID を自動生成し、配列のインデックス順序とともにローカルメモリにマッピングして保存する。 |
| name | string | すべてのAPIから提供される関数名をそのままパススルーする。 |
| arguments | Record\<string, any\> | **OpenAI:** 文字列として渡されるため、アダプターが JSON.parse(function.arguments) を実行してオブジェクト化する。 **Anthropic/Gemini:** すでにオブジェクト（input, args）として提供されているため、そのままマッピングする。 |
| raw\_context | any | （オプション）Geminiの thoughtSignature のような、次ターンへのパススルーが必要な固有のコンテキストデータを保存するためのメタデータフィールド13。 |

### **5.3 UniversalToolResult スキーマ定義（システム → モデル）**

ローカル関数の実行が完了し、その結果をモデルに返却するために抽象化されたデータ構造である。

| フィールド | 想定されるデータ型 | アダプターにおける変換ロジック（送信時の処理） |
| :---- | :---- | :---- |
| tool\_call\_id | string | UniversalToolCall で提供された id を設定する。 |
| name | string | 実行した関数の名称。OpenAIやAnthropicの最新仕様では必須ではないが、Geminiの functionResponse.name において厳格に要求されるため、IRとしては必須項目とする14。 |
| result | Record\<string, any\> | string | 関数の生の戻り値。 **OpenAI/Anthropicへの送信時:** 型が Record の場合は JSON.stringify(result) を適用して content に割り当てる。文字列の場合はそのまま渡す。 **Geminiへの送信時:** 型が Record の場合はそのまま response に割り当てる。文字列の場合は、アダプターが { "result": \<文字列\> } のように新しいオブジェクトを生成してラップする14。 |
| is\_error | boolean | 実行が失敗した場合に true を設定する。 **Anthropicへの送信時:** ネイティブの is\_error パラメータにそのままマッピングする。 **OpenAI/Geminiへの送信時:** ネイティブサポートがないため、アダプターが result の内容を動的に書き換え、"Execution Error: " \+ result のようなプレフィックスを付けてセマンティクスとしてモデルに伝達する9。 |
| multimodal\_parts | Array\<UniversalPart\> | （オプション）画像やバイナリデータを返す場合に使用。OpenAIの ArrayOfContentParts、Anthropicの image/document ブロック、またはGeminiの FunctionResponsePart へとそれぞれの仕様に合わせてトランスパイルされる8。 |

### **5.4 統合アダプターのデータフローマネジメント事例**

この中間フォーマットがどのように機能するかを示す具体的なシナリオとして、ミドルウェアが { "location": "Tokyo" } を引数に取り、天気APIから { "temp": 22, "condition": "sunny" } という結果を取得するプロセスを想定する。

**【フェーズ1：モデルからの受信と正規化】**

1. **OpenAIからの受信:** ペイロードは { "id": "call\_123", "function": { "name": "get\_weather", "arguments": "{\\"location\\":\\"Tokyo\\"}" } } となる。  
2. **アダプターによるIR化:** JSON.parse が介入し、UniversalToolCall として { id: "call\_123", name: "get\_weather", arguments: { location: "Tokyo" } } がシステムに渡される。

**【フェーズ2：アプリケーションの実行】**

1. システムは引数を用いて天気APIを叩き、辞書オブジェクト { temp: 22, condition: "sunny" } を得る。  
2. システムはこれを UniversalToolResult にパッケージ化する：{ tool\_call\_id: "call\_123", name: "get\_weather", result: { temp: 22, condition: "sunny" }, is\_error: false }。

**【フェーズ3：モデルへの返却と逆正規化】**

1. **宛先がOpenAIの場合:** アダプターは result がオブジェクトであることを検知し、JSON.stringify を適用する。最終的なRESTリクエストは { "role": "tool", "tool\_call\_id": "call\_123", "content": "{\\"temp\\":22,\\"condition\\":\\"sunny\\"}" } となる。  
2. **宛先がGeminiの場合:** アダプターは result オブジェクトをそのまま保持し、ローカルにマッピングされた配列インデックスに基づいて構造を構築する。最終的なRESTリクエストは { "functionResponse": { "name": "get\_weather", "response": { "temp": 22, "condition": "sunny" } } } となる。  
3. **宛先がAnthropicの場合:** アダプターは JSON.stringify を適用し、ブロック構造にマッピングする。最終的なリクエストは { "role": "user", "content": \[ { "type": "tool\_result", "tool\_use\_id": "call\_123", "content": "{\\"temp\\":22,\\"condition\\":\\"sunny\\"}", "is\_error": false } \] } となる。

このように、ミドルウェア層における動的な型変換とシリアライゼーションの自動解決、およびID生成・バッファリングメカニズムを実装することで、開発者はAPIごとのスキーマの差異（特に content: string に対する JSON.stringify の要否や、result: Record に対する文字列ラップの要否）を一切意識することなく、単一のビジネスロジックで複数の基盤モデルを自在に切り替えながらエージェントシステムを構築することが可能となる。

## ---

**6\. 結論**

LLMエコシステムにおけるツールオーケストレーションのデータ構造は、各社の歴史的なシステム要件と生成パラダイムの違いから、高度に断片化されている。OpenAIは自己回帰的ストリーミングの制約からJSONの文字列化を前提とした content: string アプローチを採用し、開発者にデシリアライズの負担を課している1。対照的に、Google（Vertex AI / GenAI）はgRPC等のインフラ的背景から厳格なオブジェクト指向を採用しており、結果の返却においてさえ文字列プリミティブを拒絶し、response: Record\<string, any\>（Struct）の箱詰めを要求する14。Anthropicはその中間に位置し、引数はオブジェクトとしてパース済みで提供しつつも、結果の返却には厳格な配列ブロック順序と文字列化されたJSONを要求し、さらには独自のエラーフラグを備えている9。

これらのAPI群を統一的に扱う「中間フォーマット」の策定においては、単なるフィールド名のマッピング（例：tool\_call\_id を name に変換するなど）に留まらない、より深いレイヤーでの「型のミューテーション（突然変異）」を制御するアダプターアーキテクチャが必須である。本報告書で定義した UniversalToolCall および UniversalToolResult スキーマは、この断層を吸収し、ネイティブなプログラミング言語のオブジェクトを中心に据えることで、システム側の可読性と堅牢性を確保するよう設計されている。結果として、content: string と result: Record\<...\> という相容れない要求仕様は、中間フォーマットの境界における自動的な JSON.stringify 操作とオブジェクトラッピング操作によって完全に隠蔽され、真にプロバイダーアグノスティック（特定のAPIに依存しない）な高度なAIエージェントの開発基盤が実現されると推察される。

#### **引用文献**

1. Chat | OpenAI API Reference, 2月 20, 2026にアクセス、 [https://developers.openai.com/api/reference/resources/chat/](https://developers.openai.com/api/reference/resources/chat/)  
2. Chat | OpenAI API Reference \- OpenAI for developers, 2月 20, 2026にアクセス、 [https://platform.openai.com/docs/api-reference/chat/create\#chat-create-messages](https://platform.openai.com/docs/api-reference/chat/create#chat-create-messages)  
3. Structured model outputs | OpenAI API, 2月 20, 2026にアクセス、 [https://developers.openai.com/api/docs/guides/structured-outputs/](https://developers.openai.com/api/docs/guides/structured-outputs/)  
4. Function calling | OpenAI API, 2月 20, 2026にアクセス、 [https://developers.openai.com/api/docs/guides/function-calling/](https://developers.openai.com/api/docs/guides/function-calling/)  
5. Introducing Structured Outputs in the API \- OpenAI, 2月 20, 2026にアクセス、 [https://openai.com/index/introducing-structured-outputs-in-the-api/](https://openai.com/index/introducing-structured-outputs-in-the-api/)  
6. Partially structured output? Free text output, but force correct tool call JSON \- API, 2月 20, 2026にアクセス、 [https://community.openai.com/t/partially-structured-output-free-text-output-but-force-correct-tool-call-json/955147](https://community.openai.com/t/partially-structured-output-free-text-output-but-force-correct-tool-call-json/955147)  
7. Responses | OpenAI API Reference, 2月 20, 2026にアクセス、 [https://platform.openai.com/docs/api-reference/responses](https://platform.openai.com/docs/api-reference/responses)  
8. OpenAI Responses API: The Ultimate Developer Guide \- DataCamp, 2月 20, 2026にアクセス、 [https://www.datacamp.com/tutorial/openai-responses-api](https://www.datacamp.com/tutorial/openai-responses-api)  
9. How to implement tool use \- Claude API Docs, 2月 20, 2026にアクセス、 [https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use)  
10. Claude 4.5: Function Calling and Tool Use \- Composio, 2月 20, 2026にアクセス、 [https://composio.dev/blog/claude-function-calling-tools](https://composio.dev/blog/claude-function-calling-tools)  
11. Differences in Response Models between the Vertex AI SDK and the Gen AI SDK \- Dev.to, 2月 20, 2026にアクセス、 [https://dev.to/polar3130/differences-in-response-models-between-the-vertex-ai-sdk-and-the-gen-ai-sdk-4m49](https://dev.to/polar3130/differences-in-response-models-between-the-vertex-ai-sdk-and-the-gen-ai-sdk-4m49)  
12. Google Gen AI SDK documentation, 2月 20, 2026にアクセス、 [https://googleapis.github.io/python-genai/](https://googleapis.github.io/python-genai/)  
13. Function calling reference | Generative AI on Vertex AI \- Google Cloud Documentation, 2月 20, 2026にアクセス、 [https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/function-calling](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/function-calling)  
14. Generate content with the Gemini API in Vertex AI \- Google Cloud Documentation, 2月 20, 2026にアクセス、 [https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference)  
15. Function calling with the Gemini API | Google AI for Developers, 2月 20, 2026にアクセス、 [https://ai.google.dev/gemini-api/docs/function-calling](https://ai.google.dev/gemini-api/docs/function-calling)  
16. Gemini 3 Developer Guide | Gemini API \- Google AI for Developers, 2月 20, 2026にアクセス、 [https://ai.google.dev/gemini-api/docs/gemini-3](https://ai.google.dev/gemini-api/docs/gemini-3)  
17. Why does Gemini's OpenAI-compatible API set tool\_call\_id to an empty string? : r/LLMDevs, 2月 20, 2026にアクセス、 [https://www.reddit.com/r/LLMDevs/comments/1mlust4/why\_does\_geminis\_openaicompatible\_api\_set\_tool/](https://www.reddit.com/r/LLMDevs/comments/1mlust4/why_does_geminis_openaicompatible_api_set_tool/)  
18. Discussion: Should parallel tool responses preserve call order? · Issue \#17065 · google-gemini/gemini-cli \- GitHub, 2月 20, 2026にアクセス、 [https://github.com/google-gemini/gemini-cli/issues/17065](https://github.com/google-gemini/gemini-cli/issues/17065)  
19. Tool calling with OpenAI API not working \- Gemini API \- Google AI Developers Forum, 2月 20, 2026にアクセス、 [https://discuss.ai.google.dev/t/tool-calling-with-openai-api-not-working/60140](https://discuss.ai.google.dev/t/tool-calling-with-openai-api-not-working/60140)  
20. Content | Generative AI on Vertex AI | Google Cloud Documentation, 2月 20, 2026にアクセス、 [https://docs.cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1/Content](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1/Content)